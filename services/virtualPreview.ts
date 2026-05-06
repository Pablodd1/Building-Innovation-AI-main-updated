/**
 * VirtualPreviewEngine
 * Client-side wall detection + CSS 3D overlay for real-time product preview
 * No API calls, no server required
 */

export interface Point {
  x: number;
  y: number;
}

export interface Quad {
  corners: Point[];
  score: number;
}

export interface OverlayStyle {
  transform: string;
  transformOrigin: string;
  opacity: number;
  mixBlendMode: string;
  backgroundImage: string;
  backgroundSize: string;
  position: string;
  top: string;
  left: string;
  pointerEvents: string;
  width: string;
  height: string;
}

export class VirtualPreviewEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  
  bgImage: HTMLImageElement | null = null;
  productImage: HTMLImageElement | null = null;
  productSrc: string = '';
  corners: Point[] = [];
  detectedQuads: Point[][] = [];
  activeQuad: number = 0;
  draggedCorner: number = -1;
  
  productOpacity: number = 0.92;
  productScale: number = 1.0;
  blendMode: string = 'multiply';
  showEdges: boolean = false;
  private edgeData: Float32Array | null = null;
  private cssMatrix: string | null = null;
  
  onUpdate: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  }

  loadBackground(src: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.bgImage = img;
        const maxDim = 1200;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w *= ratio;
          h *= ratio;
        }
        this.canvas.width = w;
        this.canvas.height = h;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.draw();
        this.runWallDetection();
        this.recomputeMatrix();
        resolve({ width: w, height: h });
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  loadProduct(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // Only set crossOrigin for external images (avoid tainting same-origin assets)
      try {
        const url = new URL(src, window.location.href);
        if (url.origin !== window.location.origin) {
          img.crossOrigin = 'anonymous';
        }
      } catch {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => {
        this.productImage = img;
        this.productSrc = src;
        this.recomputeMatrix();
        this.draw();
        resolve(img);
      };
      img.onerror = () => reject(new Error(`Failed to load product: ${src}`));
      img.src = src;
    });
  }

  // ========== WALL DETECTION ==========

  private runWallDetection(): void {
    if (!this.bgImage) return;
    const { width, height } = this.canvas;
    const imgData = this.ctx.getImageData(0, 0, width, height);
    const pixels = imgData.data;

    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      gray[i] = pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
    }

    const blurred = this.gaussianBlur(gray, width, height);
    const edges = this.sobelEdges(blurred, width, height);
    this.edgeData = edges;

    const lines = this.detectLines(edges, width, height);
    this.detectedQuads = this.extractQuads(lines, width, height);

    if (this.detectedQuads.length > 0) {
      this.activeQuad = 0;
      this.corners = this.detectedQuads[0].map(p => ({ ...p }));
    } else {
      const padX = width * 0.15;
      const padY = height * 0.1;
      this.corners = [
        { x: padX, y: padY },
        { x: width - padX, y: padY },
        { x: width - padX, y: height - padY },
        { x: padX, y: height - padY }
      ];
    }
  }

  private gaussianBlur(input: Float32Array, w: number, h: number): Float32Array {
    const output = new Float32Array(w * h);
    const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
    const ksum = 16;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            sum += input[(y + ky) * w + (x + kx)] * kernel[(ky + 1) * 3 + (kx + 1)];
          }
        }
        output[y * w + x] = sum / ksum;
      }
    }
    return output;
  }

  private sobelEdges(input: Float32Array, w: number, h: number): Float32Array {
    const output = new Float32Array(w * h);
    const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let sx = 0, sy = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const v = input[(y + ky) * w + (x + kx)];
            sx += v * gx[(ky + 1) * 3 + (kx + 1)];
            sy += v * gy[(ky + 1) * 3 + (kx + 1)];
          }
        }
        output[y * w + x] = Math.sqrt(sx * sx + sy * sy);
      }
    }
    return output;
  }

  private detectLines(edges: Float32Array, w: number, h: number) {
    const threshold = 60;
    const minLineLen = Math.min(w, h) * 0.15;
    const lines: { horizontal: any[], vertical: any[] } = { horizontal: [], vertical: [] };

    for (let y = 5; y < h - 5; y += 3) {
      let streak = 0, startX = 0;
      for (let x = 0; x < w; x++) {
        if (edges[y * w + x] > threshold) {
          if (streak === 0) startX = x;
          streak++;
        } else {
          if (streak > minLineLen) lines.horizontal.push({ y, x1: startX, x2: x, length: streak });
          streak = 0;
        }
      }
    }

    for (let x = 5; x < w - 5; x += 3) {
      let streak = 0, startY = 0;
      for (let y = 0; y < h; y++) {
        if (edges[y * w + x] > threshold) {
          if (streak === 0) startY = y;
          streak++;
        } else {
          if (streak > minLineLen) lines.vertical.push({ x, y1: startY, y2: y, length: streak });
          streak = 0;
        }
      }
    }

    lines.horizontal.sort((a, b) => b.length - a.length);
    lines.vertical.sort((a, b) => b.length - a.length);
    lines.horizontal = lines.horizontal.slice(0, 8);
    lines.vertical = lines.vertical.slice(0, 8);
    return lines;
  }

  private extractQuads(lines: any, w: number, h: number): Point[][] {
    const quads: { corners: Point[]; score: number }[] = [];
    const hLines = lines.horizontal;
    const vLines = lines.vertical;
    if (hLines.length < 2 || vLines.length < 2) return [];

    for (let i = 0; i < Math.min(hLines.length, 4); i++) {
      for (let j = i + 1; j < Math.min(hLines.length, 5); j++) {
        const top = hLines[i], bottom = hLines[j];
        if (Math.abs(top.y - bottom.y) < h * 0.15) continue;
        for (let k = 0; k < Math.min(vLines.length, 4); k++) {
          for (let l = k + 1; l < Math.min(vLines.length, 5); l++) {
            const left = vLines[k], right = vLines[l];
            if (Math.abs(left.x - right.x) < w * 0.15) continue;
            if (left.x < top.x1 || left.x > top.x2) continue;
            if (right.x < top.x1 || right.x > top.x2) continue;
            if (top.y < left.y1 || top.y > left.y2) continue;
            if (bottom.y < left.y1 || bottom.y > left.y2) continue;

            const tl = { x: left.x, y: top.y };
            const tr = { x: right.x, y: top.y };
            const br = { x: right.x, y: bottom.y };
            const bl = { x: left.x, y: bottom.y };
            const area = (right.x - left.x) * (bottom.y - top.y);
            const score = area + top.length + bottom.length + left.length + right.length;
            quads.push({ corners: [tl, tr, br, bl], score });
          }
        }
      }
    }

    quads.sort((a, b) => b.score - a.score);
    const unique: Point[][] = [];
    for (const q of quads) {
      let dup = false;
      for (const u of unique) {
        const dx = q.corners.map((c, i) => Math.abs(c.x - u[i].x)).reduce((a, b) => a + b, 0);
        const dy = q.corners.map((c, i) => Math.abs(c.y - u[i].y)).reduce((a, b) => a + b, 0);
        if (dx < w * 0.05 && dy < h * 0.05) { dup = true; break; }
      }
      if (!dup) unique.push(q.corners);
      if (unique.length >= 3) break;
    }
    return unique;
  }

  // ========== MATRIX / TRANSFORM ==========

  private computeNormalizedHomography(dst: Point[]): number[] {
    return this.computeTransform(1, 1, dst);
  }

  private computeTransform(srcW: number, srcH: number, dst: Point[]): number[] {
    const sx = [0, srcW, srcW, 0];
    const sy = [0, 0, srcH, srcH];
    const dx = [dst[0].x, dst[1].x, dst[2].x, dst[3].x];
    const dy = [dst[0].y, dst[1].y, dst[2].y, dst[3].y];
    const A: number[][] = [], B: number[] = [];
    for (let i = 0; i < 4; i++) {
      A.push([sx[i], sy[i], 1, 0, 0, 0, -sx[i]*dx[i], -sy[i]*dx[i]]);
      A.push([0, 0, 0, sx[i], sy[i], 1, -sx[i]*dy[i], -sy[i]*dy[i]]);
      B.push(dx[i], dy[i]);
    }
    const h = this.solveLinear(A, B);
    return [...h, 1];
  }

  private solveLinear(A: number[][], B: number[]): number[] {
    const n = A.length;
    for (let i = 0; i < n; i++) {
      let max = i;
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(A[j][i]) > Math.abs(A[max][i])) max = j;
      }
      [A[i], A[max]] = [A[max], A[i]];
      [B[i], B[max]] = [B[max], B[i]];
      for (let j = i + 1; j < n; j++) {
        const factor = A[j][i] / A[i][i];
        for (let k = i; k < n; k++) A[j][k] -= factor * A[i][k];
        B[j] -= factor * B[i];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let sum = B[i];
      for (let j = i + 1; j < n; j++) sum -= A[i][j] * x[j];
      x[i] = sum / A[i][i];
    }
    return x;
  }

  recomputeMatrix(): void {
    if (!this.corners || this.corners.length !== 4) {
      this.cssMatrix = null;
      return;
    }
    const w = this.canvas.width;
    const h = this.canvas.height;

    const H = this.computeNormalizedHomography(this.corners);
    const [h11, h12, h13, h21, h22, h23, h31, h32, h33] = H;

    const m11 = h11 / w;
    const m12 = h12 / h;
    const m13 = h13;
    const m21 = h21 / w;
    const m22 = h22 / h;
    const m23 = h23;
    const m31 = h31 / w;
    const m32 = h32 / h;
    const m33 = h33;

    // CSS matrix3d is column-major
    this.cssMatrix = `matrix3d(${m11},${m21},0,${m31},${m12},${m22},0,${m32},0,0,1,0,${m13},${m23},0,${m33})`;
    if (this.onUpdate) this.onUpdate();
  }

  getOverlayStyle(): Partial<OverlayStyle> {
    return {
      transform: this.cssMatrix || 'none',
      transformOrigin: '0 0',
      opacity: this.productOpacity,
      mixBlendMode: this.blendMode === 'normal' ? 'normal' : this.blendMode as any,
      backgroundImage: this.productSrc ? `url(${this.productSrc})` : 'none',
      backgroundSize: '100% 100%',
      position: 'absolute',
      top: '0',
      left: '0',
      pointerEvents: 'none',
      width: this.canvas?.width + 'px',
      height: this.canvas?.height + 'px',
    };
  }

  // ========== EXPORT (Triangle Mesh) ==========

  exportToCanvas(): HTMLCanvasElement {
    if (!this.bgImage || !this.productImage || this.corners.length !== 4) {
      throw new Error('Background and product must be loaded');
    }
    const { width, height } = this.canvas;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = width;
    outCanvas.height = height;
    const ctx = outCanvas.getContext('2d')!;

    ctx.drawImage(this.bgImage, 0, 0, width, height);

    const H = this.computeTransform(this.productImage.width, this.productImage.height, this.corners);
    const inv = this.invertMatrix3x3(H);
    this.drawMeshWarp(ctx, this.productImage, inv, width, height, this.productOpacity, 20);

    return outCanvas;
  }

  private invertMatrix3x3(m: number[]): number[] {
    const [a, b, c, d, e, f, g, h, i] = m;
    const det = a*(e*i - f*h) - b*(d*i - f*g) + c*(d*h - e*g);
    if (Math.abs(det) < 0.0001) return [1,0,0,0,1,0,0,0,1];
    const invDet = 1 / det;
    return [
      (e*i - f*h)*invDet, -(b*i - c*h)*invDet, (b*f - c*e)*invDet,
      -(d*i - f*g)*invDet, (a*i - c*g)*invDet, -(a*f - c*d)*invDet,
      (d*h - e*g)*invDet, -(a*h - b*g)*invDet, (a*e - b*d)*invDet
    ];
  }

  private drawMeshWarp(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    invH: number[],
    cw: number, ch: number,
    opacity: number,
    gridN: number
  ): void {
    const iw = img.width;
    const ih = img.height;
    const [i11, i12, i13, i21, i22, i23, i31, i32, i33] = invH;

    const mapForward = (sx: number, sy: number) => {
      const w_ = i31 * sx + i32 * sy + i33;
      return {
        x: (i11 * sx + i12 * sy + i13) / w_,
        y: (i21 * sx + i22 * sy + i23) / w_
      };
    };

    const vgrid: { sx: number; sy: number; x: number; y: number }[][] = [];
    for (let j = 0; j <= gridN; j++) {
      const row = [];
      for (let i = 0; i <= gridN; i++) {
        const sx = (i / gridN) * iw;
        const sy = (j / gridN) * ih;
        row.push({ sx, sy, ...mapForward(sx, sy) });
      }
      vgrid.push(row);
    }

    ctx.globalAlpha = opacity;
    for (let j = 0; j < gridN; j++) {
      for (let i = 0; i < gridN; i++) {
        const tl = vgrid[j][i];
        const tr = vgrid[j][i + 1];
        const br = vgrid[j + 1][i + 1];
        const bl = vgrid[j + 1][i];
        this.drawTriangle(ctx, img, tl, tr, bl);
        this.drawTriangle(ctx, img, tr, br, bl);
      }
    }
    ctx.globalAlpha = 1.0;
  }

  private drawTriangle(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    p1: any, p2: any, p3: any
  ): void {
    const { sx: u1, sy: v1, x: x1, y: y1 } = p1;
    const { sx: u2, sy: v2, x: x2, y: y2 } = p2;
    const { sx: u3, sy: v3, x: x3, y: y3 } = p3;

    const det = (u2 - u1) * (v3 - v1) - (u3 - u1) * (v2 - v1);
    if (Math.abs(det) < 0.001) return;

    const a = ((x2 - x1) * (v3 - v1) - (x3 - x1) * (v2 - v1)) / det;
    const b = ((u2 - u1) * (x3 - x1) - (u3 - u1) * (x2 - x1)) / det;
    const c = x1 - a * u1 - b * v1;
    const d = ((y2 - y1) * (v3 - v1) - (y3 - y1) * (v2 - v1)) / det;
    const e = ((u2 - u1) * (y3 - y1) - (u3 - u1) * (y2 - y1)) / det;
    const f = y1 - d * u1 - e * v1;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.clip();

    ctx.setTransform(a, d, b, e, c, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  // ========== DRAWING ==========

  draw(): void {
    if (!this.bgImage) return;
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.bgImage, 0, 0, width, height);

    if (this.showEdges && this.edgeData) {
      const edgeImg = ctx.getImageData(0, 0, width, height);
      for (let i = 0; i < width * height; i++) {
        const v = Math.min(255, this.edgeData[i] * 2);
        edgeImg.data[i * 4] = v;
        edgeImg.data[i * 4 + 1] = v;
        edgeImg.data[i * 4 + 2] = v;
        edgeImg.data[i * 4 + 3] = 100;
      }
      ctx.putImageData(edgeImg, 0, 0);
    }

    if (this.corners.length === 4) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(this.corners[0].x, this.corners[0].y);
      for (let i = 1; i <= 4; i++) {
        const c = this.corners[i % 4];
        ctx.lineTo(c.x, c.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      for (let i = 0; i < 4; i++) {
        const c = this.corners[i];
        ctx.fillStyle = i === this.draggedCorner ? '#ef4444' : '#3b82f6';
        ctx.beginPath();
        ctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    if (this.showEdges && this.detectedQuads.length > 1) {
      for (let q = 0; q < this.detectedQuads.length; q++) {
        if (q === this.activeQuad) continue;
        const quad = this.detectedQuads[q];
        ctx.strokeStyle = 'rgba(34,197,94,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(quad[0].x, quad[0].y);
        for (let i = 1; i <= 4; i++) {
          const c = quad[i % 4];
          ctx.lineTo(c.x, c.y);
        }
        ctx.stroke();
      }
    }
  }

  // ========== POINTER HANDLING ==========

  handlePointerDown(x: number, y: number): boolean {
    let nearest = -1;
    let nearestDist = Infinity;
    for (let i = 0; i < this.corners.length; i++) {
      const c = this.corners[i];
      const dist = Math.hypot(c.x - x, c.y - y);
      if (dist < 20 && dist < nearestDist) {
        nearest = i;
        nearestDist = dist;
      }
    }
    this.draggedCorner = nearest;
    return nearest >= 0;
  }

  handlePointerMove(x: number, y: number): boolean {
    if (this.draggedCorner >= 0) {
      this.corners[this.draggedCorner] = {
        x: Math.max(0, Math.min(this.canvas.width, x)),
        y: Math.max(0, Math.min(this.canvas.height, y))
      };
      this.recomputeMatrix();
      this.draw();
      return true;
    }
    for (let i = 0; i < this.corners.length; i++) {
      const c = this.corners[i];
      if (Math.hypot(c.x - x, c.y - y) < 15) {
        this.canvas.style.cursor = 'move';
        return false;
      }
    }
    this.canvas.style.cursor = 'default';
    return false;
  }

  handlePointerUp(): void {
    this.draggedCorner = -1;
    this.canvas.style.cursor = 'default';
  }

  // ========== CONTROLS ==========

  selectQuad(index: number): void {
    if (index >= 0 && index < this.detectedQuads.length) {
      this.activeQuad = index;
      this.corners = this.detectedQuads[index].map(p => ({ ...p }));
      this.recomputeMatrix();
      this.draw();
    }
  }

  setOpacity(v: number): void { this.productOpacity = v; if (this.onUpdate) this.onUpdate(); }
  setScale(v: number): void { this.productScale = v; this.recomputeMatrix(); }
  setBlendMode(m: string): void { this.blendMode = m; if (this.onUpdate) this.onUpdate(); }
  toggleEdges(): void { this.showEdges = !this.showEdges; this.draw(); }

  exportImage(): string {
    const canvas = this.exportToCanvas();
    return canvas.toDataURL('image/jpeg', 0.92);
  }
}
