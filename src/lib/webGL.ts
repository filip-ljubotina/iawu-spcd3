// webglCanvas.ts
import { getLineName } from "./brush";
import { canvasEl, lineState } from "./globals";

let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram;

// Persistent GPU buffer
let vertexBuffer: WebGLBuffer | null = null;

// Cached attribute/uniform locations
let posLoc: number;
let resolutionLoc: WebGLUniformLocation;
let colorLoc: WebGLUniformLocation;

// Vertex and fragment shaders
const vertexShaderSrc = `
attribute vec2 position;
uniform vec2 resolution;

void main() {
  // convert canvas coords (top-left 0,0) to clip space (-1..1)
  vec2 zeroToOne = position / resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
}
`;

const fragmentShaderSrc = `
precision mediump float;
uniform vec4 u_color; // single color per batch
void main() {
  gl_FragColor = u_color;
}
`;

// compile shader
function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    throw new Error("Shader compile failed");
  }
  return shader;
}

// create program
function createProgram(gl: WebGLRenderingContext, vShader: WebGLShader, fShader: WebGLShader) {
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  gl.attachShader(program, vShader);
  gl.attachShader(program, fShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    throw new Error("Program link failed");
  }
  return program;
}

// initialize WebGL
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

  // no blending for max speed
  gl.disable(gl.BLEND);

  // create persistent buffer
  vertexBuffer = gl.createBuffer();
  if (!vertexBuffer) throw new Error("Failed to create vertex buffer");

  // cache locations
  posLoc = gl.getAttribLocation(program, "position");
  resolutionLoc = gl.getUniformLocation(program, "resolution")!;
  colorLoc = gl.getUniformLocation(program, "u_color")!;

  return gl;
}

// convert row data to canvas XY points
function getPolylinePoints(d: any, parcoords: any, dpr: number): [number, number][] {
  const pts: [number, number][] = [];
  parcoords.newFeatures.forEach((name: string) => {
    const x = (parcoords.dragging[name] ?? parcoords.xScales(name)) * dpr;
    const y = parcoords.yScales[name](d[name]) * dpr;
    pts.push([x, y]);
  });
  return pts;
}

// prepare batched vertices for active/inactive lines
function prepareBatches(dataset: any[], parcoords: any, dpr: number) {
  const activeVertices: number[] = [];
  const inactiveVertices: number[] = [];

  for (const d of dataset) {
    const id = getLineName(d);
    const active = lineState[id]?.active ?? true;
    const pts = getPolylinePoints(d, parcoords, dpr);
    if (pts.length < 2) continue;

    // push each segment as x0,y0,x1,y1
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      if (active) activeVertices.push(x0, y0, x1, y1);
      else inactiveVertices.push(x0, y0, x1, y1);
    }
  }

  return {
    active: new Float32Array(activeVertices),
    inactive: new Float32Array(inactiveVertices)
  };
}

// draw a batch of lines
function drawBatch(vertices: Float32Array, color: [number, number, number, number]) {
  if (!gl || !vertexBuffer || vertices.length === 0) return;

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  gl.useProgram(program);
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  gl.uniform2f(resolutionLoc, canvasEl.width, canvasEl.height);
  gl.uniform4f(colorLoc, color[0], color[1], color[2], color[3]);

  gl.drawArrays(gl.LINES, 0, vertices.length / 2);
}

// redraw all lines
export function redrawWebGLLines(dataset: any[], parcoords: any) {
  if (!gl || !vertexBuffer) return;

  gl.clear(gl.COLOR_BUFFER_BIT);
  const dpr = window.devicePixelRatio || 1;

  const batches = prepareBatches(dataset, parcoords, dpr);

  // draw active lines first
  drawBatch(batches.active, [0 / 255, 100 / 255, 150 / 255, 1]);

  // then draw inactive lines
  drawBatch(batches.inactive, [150 / 255, 150 / 255, 150 / 255, 1]);
}
