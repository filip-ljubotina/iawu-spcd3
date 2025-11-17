// webglCanvas.ts
import { getLineName } from "./brush";
import { canvasEl, lineState } from "./globals";

let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram;

// Persistent GPU buffers
let vertexBuffer: WebGLBuffer | null = null;

// Cached attribute/uniform locations
let posLoc: number;
let resolutionLoc: WebGLUniformLocation;
let colorLoc: WebGLUniformLocation;

// Persistent Float32Arrays for batching (avoid allocations)
let activeVertexData: Float32Array | null = null;
let inactiveVertexData: Float32Array | null = null;

// Vertex shader: converts canvas coords to clip space
const vertexShaderSrc = `
attribute vec2 position;
uniform vec2 resolution;

void main() {
  vec2 zeroToOne = position / resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1); // flip Y
}
`;

// Fragment shader: single color per line batch
const fragmentShaderSrc = `
precision mediump float;
uniform vec4 u_color;

void main() {
  gl_FragColor = u_color;
}
`;

// Compile a shader
function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    throw new Error("Shader compile failed");
  }
  return shader;
}

// Link program
function createProgram(gl: WebGLRenderingContext, vShader: WebGLShader, fShader: WebGLShader) {
  const program = gl.createProgram()!;
  gl.attachShader(program, vShader);
  gl.attachShader(program, fShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    throw new Error("Program link failed");
  }
  return program;
}

// Initialize WebGL
export function initCanvasWebGL() {
  const dpr = window.devicePixelRatio || 1;
  canvasEl.width = canvasEl.clientWidth * dpr;
  canvasEl.height = canvasEl.clientHeight * dpr;

  gl = canvasEl.getContext("webgl");
  if (!gl) throw new Error("WebGL not supported");

  const vShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSrc);
  const fShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSrc);
  program = createProgram(gl, vShader, fShader);

  gl.viewport(0, 0, canvasEl.width, canvasEl.height);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Disable alpha blending for maximum speed
  gl.disable(gl.BLEND);

  // Create persistent buffer
  vertexBuffer = gl.createBuffer();

  // Cache locations
  posLoc = gl.getAttribLocation(program, "position");
  resolutionLoc = gl.getUniformLocation(program, "resolution")!;
  colorLoc = gl.getUniformLocation(program, "u_color")!;

  return gl;
}

// Convert row data to xy points
function getPolylinePoints(d: any, parcoords: any, dpr: number): [number, number][] {
  const pts: [number, number][] = [];
  parcoords.newFeatures.forEach((name: string) => {
    const x = (parcoords.dragging[name] ?? parcoords.xScales(name)) * dpr;
    const y = parcoords.yScales[name](d[name]) * dpr;
    pts.push([x, y]);
  });
  return pts;
}

// Prepares batched vertex arrays
function prepareBatches(dataset: any[], parcoords: any, dpr: number) {
  const activeVertices: number[] = [];
  const inactiveVertices: number[] = [];

  for (const d of dataset) {
    const id = getLineName(d);
    const active = lineState[id]?.active ?? true;
    const pts = getPolylinePoints(d, parcoords, dpr);
    if (pts.length < 2) continue;

    // push as line segments (x0,y0,x1,y1) for gl.LINES
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      if (active) {
        activeVertices.push(x0, y0, x1, y1);
      } else {
        inactiveVertices.push(x0, y0, x1, y1);
      }
    }
  }

  activeVertexData = new Float32Array(activeVertices);
  inactiveVertexData = new Float32Array(inactiveVertices);
}

// Draw a batch of lines
function drawBatch(vertices: Float32Array | null, color: [number, number, number, number]) {
  if (!gl || !vertexBuffer || !vertices || !vertices.length) return;

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  gl.useProgram(program);
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  gl.uniform2f(resolutionLoc, canvasEl.width, canvasEl.height);
  gl.uniform4f(colorLoc, color[0], color[1], color[2], color[3]);

  gl.drawArrays(gl.LINES, 0, vertices.length / 2);
}

// Redraw all lines
export function redrawWebGLLines(dataset: any[], parcoords: any) {
  if (!gl || !vertexBuffer) return;

  gl.clear(gl.COLOR_BUFFER_BIT);

  const dpr = window.devicePixelRatio || 1;

  // prepare batched vertex arrays once per frame
  prepareBatches(dataset, parcoords, dpr);

  // draw active lines in one call
  drawBatch(activeVertexData, [0 / 255, 100 / 255, 150 / 255, 1]);

  // draw inactive lines in one call
  drawBatch(inactiveVertexData, [150 / 255, 150 / 255, 150 / 255, 1]);
}
