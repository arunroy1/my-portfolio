/* -------------------------------------------------------------------------- */
/*                           Fluid / Ink Simulation                           */
/* -------------------------------------------------------------------------- */

class FluidSimulator {
    constructor() {
        this.canvas = document.getElementById('fluid-canvas');
        if (!this.canvas) {
            console.error("FluidSimulator: Canvas #fluid-canvas not found.");
            return;
        }

        this.config = {
            SIM_RESOLUTION: 128,
            DYE_RESOLUTION: 1024,
            CAPTURE_RESOLUTION: 512,
            DENSITY_DISSIPATION: 1, // Slower dissipation for ink
            VELOCITY_DISSIPATION: 0.2,
            PRESSURE: 0.8,
            PRESSURE_ITERATIONS: 20,
            CURL: 30, // Higher curl for swirly ink
            SPLAT_RADIUS: 0.25,
            SPLAT_FORCE: 6000,
            SHADING: true,
            COLOR_UPDATE_SPEED: 10,
            PAUSED: false,
            BACK_COLOR: { r: 0, g: 0, b: 0 },
            TRANSPARENT: true
        };

        this.pointers = [];
        this.splatStack = [];
        this.lastUpdateTime = Date.now();
        this.colorUpdateTimer = 0.0;
        this.gl = null;
        this.ext = null;
        this.displayMaterial = null;
        this.programs = {};
        this.framebuffers = {};

        // Bind methods
        this.updateFrame = this.updateFrame.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleTouchMove = this.handleTouchMove.bind(this);
        this.handleTouchStart = this.handleTouchStart.bind(this);
        this.handleMouseClick = this.handleMouseClick.bind(this);

        this.running = false;
        this.animationId = null;
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.canvas.style.display = 'block';

        if (!this.gl) {
            this.initWebGL();
            this.addEventListeners();
        }

        this.updateFrame();
    }

    stop() {
        this.running = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.canvas.style.display = 'none';
        // Note: keeping context and listeners alive for restart is fine
    }

    initWebGL() {
        const { gl, ext } = this.getWebGLContext(this.canvas);
        this.gl = gl;
        this.ext = ext;

        if (!ext.supportLinearFiltering) {
            this.config.DYE_RESOLUTION = 512;
            this.config.SHADING = false;
        }

        this.initShaders();
        this.initFramebuffers();

        // Init pointer
        this.pointers.push(new PointerPrototype());
    }

    getWebGLContext(canvas) {
        const params = {
            alpha: true,
            depth: false,
            stencil: false,
            antialias: false,
            preserveDrawingBuffer: false
        };

        let gl = canvas.getContext('webgl2', params);
        const isWebGL2 = !!gl;
        if (!isWebGL2) gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);

        let halfFloat;
        let supportLinearFiltering;
        if (isWebGL2) {
            gl.getExtension('EXT_color_buffer_float');
            supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
        } else {
            halfFloat = gl.getExtension('OES_texture_half_float');
            supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
        }
        gl.clearColor(0.0, 0.0, 0.0, 0.0); // Transparent clear

        const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat && halfFloat.HALF_FLOAT_OES;
        let formatRGBA, formatRG, formatR;

        if (isWebGL2) {
            formatRGBA = this.getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
            formatRG = this.getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
            formatR = this.getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
        } else {
            formatRGBA = this.getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
            formatRG = this.getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
            formatR = this.getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        }

        return {
            gl,
            ext: {
                formatRGBA,
                formatRG,
                formatR,
                halfFloatTexType,
                supportLinearFiltering
            }
        };
    }

    getSupportedFormat(gl, internalFormat, format, type) {
        if (!this.supportRenderTextureFormat(gl, internalFormat, format, type)) {
            switch (internalFormat) {
                case gl.R16F:
                    return this.getSupportedFormat(gl, gl.RG16F, gl.RG, type);
                case gl.RG16F:
                    return this.getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
                default:
                    return null;
            }
        }
        return { internalFormat, format };
    }

    supportRenderTextureFormat(gl, internalFormat, format, type) {
        let texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
        let fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        return status === gl.FRAMEBUFFER_COMPLETE;
    }

    updateFrame() {
        if (!this.running) return;

        const dt = this.calcDeltaTime();
        if (this.resizeCanvas()) this.initFramebuffers();
        this.applyInputs();
        this.step(dt);
        this.render(null);

        this.animationId = requestAnimationFrame(this.updateFrame);
    }

    calcDeltaTime() {
        let now = Date.now();
        let dt = (now - this.lastUpdateTime) / 1000;
        dt = Math.min(dt, 0.016666);
        this.lastUpdateTime = now;
        return dt;
    }

    resizeCanvas() {
        let width = this.scaleByPixelRatio(window.innerWidth);
        let height = this.scaleByPixelRatio(window.innerHeight);
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            return true;
        }
        return false;
    }

    initShaders() {
        const gl = this.gl;
        const shaderSources = {
            baseVertex: `
                precision highp float;
                attribute vec2 aPosition;
                varying vec2 vUv;
                varying vec2 vL;
                varying vec2 vR;
                varying vec2 vT;
                varying vec2 vB;
                uniform vec2 texelSize;
                void main () {
                    vUv = aPosition * 0.5 + 0.5;
                    vL = vUv - vec2(texelSize.x, 0.0);
                    vR = vUv + vec2(texelSize.x, 0.0);
                    vT = vUv + vec2(0.0, texelSize.y);
                    vB = vUv - vec2(0.0, texelSize.y);
                    gl_Position = vec4(aPosition, 0.0, 1.0);
                }
            `,
            copy: `
                precision mediump float;
                precision mediump sampler2D;
                varying highp vec2 vUv;
                uniform sampler2D uTexture;
                void main () {
                    gl_FragColor = texture2D(uTexture, vUv);
                }
            `,
            clear: `
                precision mediump float;
                precision mediump sampler2D;
                varying highp vec2 vUv;
                uniform sampler2D uTexture;
                uniform float value;
                void main () {
                    gl_FragColor = value * texture2D(uTexture, vUv);
                }
            `,
            splat: `
                precision highp float;
                precision highp sampler2D;
                varying vec2 vUv;
                uniform sampler2D uTarget;
                uniform float aspectRatio;
                uniform vec3 color;
                uniform vec2 point;
                uniform float radius;
                void main () {
                    vec2 p = vUv - point.xy;
                    p.x *= aspectRatio;
                    vec3 splat = exp(-dot(p, p) / radius) * color;
                    vec3 base = texture2D(uTarget, vUv).xyz;
                    gl_FragColor = vec4(base + splat, 1.0);
                }
            `,
            advection: `
                precision highp float;
                precision highp sampler2D;
                varying vec2 vUv;
                uniform sampler2D uVelocity;
                uniform sampler2D uSource;
                uniform vec2 texelSize;
                uniform vec2 dyeTexelSize;
                uniform float dt;
                uniform float dissipation;
                vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
                    vec2 st = uv / tsize - 0.5;
                    vec2 iuv = floor(st);
                    vec2 fuv = fract(st);
                    vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
                    vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
                    vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
                    vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
                    return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
                }
                void main () {
                    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
                    vec4 result = texture2D(uSource, coord);
                    float decay = 1.0 + dissipation * dt;
                    gl_FragColor = result / decay;
                }
            `,
            divergence: `
                precision mediump float;
                precision mediump sampler2D;
                varying highp vec2 vUv;
                varying highp vec2 vL;
                varying highp vec2 vR;
                varying highp vec2 vT;
                varying highp vec2 vB;
                uniform sampler2D uVelocity;
                void main () {
                    float L = texture2D(uVelocity, vL).x;
                    float R = texture2D(uVelocity, vR).x;
                    float T = texture2D(uVelocity, vT).y;
                    float B = texture2D(uVelocity, vB).y;
                    vec2 C = texture2D(uVelocity, vUv).xy;
                    if (vL.x < 0.0) { L = -C.x; }
                    if (vR.x > 1.0) { R = -C.x; }
                    if (vT.y > 1.0) { T = -C.y; }
                    if (vB.y < 0.0) { B = -C.y; }
                    float div = 0.5 * (R - L + T - B);
                    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
                }
            `,
            curl: `
                precision mediump float;
                precision mediump sampler2D;
                varying highp vec2 vUv;
                varying highp vec2 vL;
                varying highp vec2 vR;
                varying highp vec2 vT;
                varying highp vec2 vB;
                uniform sampler2D uVelocity;
                void main () {
                    float L = texture2D(uVelocity, vL).y;
                    float R = texture2D(uVelocity, vR).y;
                    float T = texture2D(uVelocity, vT).x;
                    float B = texture2D(uVelocity, vB).x;
                    float vorticity = R - L - T + B;
                    gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
                }
            `,
            vorticity: `
                precision highp float;
                precision highp sampler2D;
                varying vec2 vUv;
                varying vec2 vL;
                varying vec2 vR;
                varying vec2 vT;
                varying vec2 vB;
                uniform sampler2D uVelocity;
                uniform sampler2D uCurl;
                uniform float curl;
                uniform float dt;
                void main () {
                    float L = texture2D(uCurl, vL).x;
                    float R = texture2D(uCurl, vR).x;
                    float T = texture2D(uCurl, vT).x;
                    float B = texture2D(uCurl, vB).x;
                    float C = texture2D(uCurl, vUv).x;
                    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
                    force /= length(force) + 0.0001;
                    force *= curl * C;
                    force.y *= -1.0;
                    vec2 velocity = texture2D(uVelocity, vUv).xy;
                    velocity += force * dt;
                    velocity = min(max(velocity, -1000.0), 1000.0);
                    gl_FragColor = vec4(velocity, 0.0, 1.0);
                }
            `,
            pressure: `
                precision mediump float;
                precision mediump sampler2D;
                varying highp vec2 vUv;
                varying highp vec2 vL;
                varying highp vec2 vR;
                varying highp vec2 vT;
                varying highp vec2 vB;
                uniform sampler2D uPressure;
                uniform sampler2D uDivergence;
                void main () {
                    float L = texture2D(uPressure, vL).x;
                    float R = texture2D(uPressure, vR).x;
                    float T = texture2D(uPressure, vT).x;
                    float B = texture2D(uPressure, vB).x;
                    float C = texture2D(uPressure, vUv).x;
                    float divergence = texture2D(uDivergence, vUv).x;
                    float pressure = (L + R + B + T - divergence) * 0.25;
                    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
                }
            `,
            gradientSubtract: `
                precision mediump float;
                precision mediump sampler2D;
                varying highp vec2 vUv;
                varying highp vec2 vL;
                varying highp vec2 vR;
                varying highp vec2 vT;
                varying highp vec2 vB;
                uniform sampler2D uPressure;
                uniform sampler2D uVelocity;
                void main () {
                    float L = texture2D(uPressure, vL).x;
                    float R = texture2D(uPressure, vR).x;
                    float T = texture2D(uPressure, vT).x;
                    float B = texture2D(uPressure, vB).x;
                    vec2 velocity = texture2D(uVelocity, vUv).xy;
                    velocity.xy -= vec2(R - L, T - B);
                    gl_FragColor = vec4(velocity, 0.0, 1.0);
                }
            `,
            display: `
                precision highp float;
                precision highp sampler2D;
                varying vec2 vUv;
                varying vec2 vL;
                varying vec2 vR;
                varying vec2 vT;
                varying vec2 vB;
                uniform sampler2D uTexture;
                uniform vec2 texelSize;
                void main () {
                    vec3 c = texture2D(uTexture, vUv).rgb;
                    float concentration = max(c.r, max(c.g, c.b));
                    
                    // INK EFFECT: 
                    // We assume concentration "1.0" means full black ink.
                    // We render BLACK pixel with ALPHA = concentration.
                    // Mixed with the paper background behind it, it will look like ink.
                    
                    gl_FragColor = vec4(0.0, 0.0, 0.0, concentration * 0.8); // 0.8 max opacity
                }
            `
        };

        const baseVertexShader = this.compileShader(gl.VERTEX_SHADER, shaderSources.baseVertex);

        this.programs.copy = new GLProgram(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, shaderSources.copy));
        this.programs.clear = new GLProgram(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, shaderSources.clear));
        this.programs.splat = new GLProgram(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, shaderSources.splat));
        this.programs.advection = new GLProgram(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, shaderSources.advection));
        this.programs.divergence = new GLProgram(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, shaderSources.divergence));
        this.programs.curl = new GLProgram(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, shaderSources.curl));
        this.programs.vorticity = new GLProgram(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, shaderSources.vorticity));
        this.programs.pressure = new GLProgram(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, shaderSources.pressure));
        this.programs.gradientSubtract = new GLProgram(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, shaderSources.gradientSubtract));

        this.displayMaterial = new Material(gl, baseVertexShader, shaderSources.display);
    }

    compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.trace(gl.getShaderInfoLog(shader));
        return shader;
    }

    initFramebuffers() {
        const gl = this.gl;
        const ext = this.ext;
        let simRes = this.getResolution(this.config.SIM_RESOLUTION);
        let dyeRes = this.getResolution(this.config.DYE_RESOLUTION);
        const texType = ext.halfFloatTexType;
        const rgba = ext.formatRGBA;
        const rg = ext.formatRG;
        const r = ext.formatR;
        const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
        gl.disable(gl.BLEND);

        this.framebuffers.dye = this.createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
        this.framebuffers.velocity = this.createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
        this.framebuffers.divergence = this.createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
        this.framebuffers.curl = this.createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
        this.framebuffers.pressure = this.createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    }

    createFBO(w, h, internalFormat, format, type, param) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        let texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

        let fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);

        return {
            texture,
            fbo,
            width: w,
            height: h,
            texelSizeX: 1.0 / w,
            texelSizeY: 1.0 / h,
            attach(id) {
                gl.activeTexture(gl.TEXTURE0 + id);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                return id;
            }
        };
    }

    createDoubleFBO(w, h, internalFormat, format, type, param) {
        let fbo1 = this.createFBO(w, h, internalFormat, format, type, param);
        let fbo2 = this.createFBO(w, h, internalFormat, format, type, param);
        return {
            width: w,
            height: h,
            texelSizeX: fbo1.texelSizeX,
            texelSizeY: fbo1.texelSizeY,
            get read() { return fbo1; },
            set read(value) { fbo1 = value; },
            get write() { return fbo2; },
            set write(value) { fbo2 = value; },
            swap() {
                let temp = fbo1;
                fbo1 = fbo2;
                fbo2 = temp;
            }
        };
    }

    getResolution(resolution) {
        const gl = this.gl;
        let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
        if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;
        const min = Math.round(resolution);
        const max = Math.round(resolution * aspectRatio);
        if (gl.drawingBufferWidth > gl.drawingBufferHeight) return { width: max, height: min };
        else return { width: min, height: max };
    }

    scaleByPixelRatio(input) {
        const pixelRatio = window.devicePixelRatio || 1;
        return Math.floor(input * pixelRatio);
    }

    // --- Simulation Steps ---

    step(dt) {
        const gl = this.gl;
        const config = this.config;
        const fbo = this.framebuffers;

        gl.disable(gl.BLEND);

        // Curl
        this.programs.curl.bind();
        gl.uniform2f(this.programs.curl.uniforms.texelSize, fbo.velocity.texelSizeX, fbo.velocity.texelSizeY);
        gl.uniform1i(this.programs.curl.uniforms.uVelocity, fbo.velocity.read.attach(0));
        this.blit(fbo.curl);

        // Vorticity
        this.programs.vorticity.bind();
        gl.uniform2f(this.programs.vorticity.uniforms.texelSize, fbo.velocity.texelSizeX, fbo.velocity.texelSizeY);
        gl.uniform1i(this.programs.vorticity.uniforms.uVelocity, fbo.velocity.read.attach(0));
        gl.uniform1i(this.programs.vorticity.uniforms.uCurl, fbo.curl.attach(1));
        gl.uniform1f(this.programs.vorticity.uniforms.curl, config.CURL);
        gl.uniform1f(this.programs.vorticity.uniforms.dt, dt);
        this.blit(fbo.velocity.write);
        fbo.velocity.swap();

        // Divergence
        this.programs.divergence.bind();
        gl.uniform2f(this.programs.divergence.uniforms.texelSize, fbo.velocity.texelSizeX, fbo.velocity.texelSizeY);
        gl.uniform1i(this.programs.divergence.uniforms.uVelocity, fbo.velocity.read.attach(0));
        this.blit(fbo.divergence);

        // Clear Pressure
        this.programs.clear.bind();
        gl.uniform1i(this.programs.clear.uniforms.uTexture, fbo.pressure.read.attach(0));
        gl.uniform1f(this.programs.clear.uniforms.value, config.PRESSURE);
        this.blit(fbo.pressure.write);
        fbo.pressure.swap();

        // Pressure
        this.programs.pressure.bind();
        gl.uniform2f(this.programs.pressure.uniforms.texelSize, fbo.velocity.texelSizeX, fbo.velocity.texelSizeY);
        gl.uniform1i(this.programs.pressure.uniforms.uDivergence, fbo.divergence.attach(0));
        for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
            gl.uniform1i(this.programs.pressure.uniforms.uPressure, fbo.pressure.read.attach(1));
            this.blit(fbo.pressure.write);
            fbo.pressure.swap();
        }

        // Gradient Subtract
        this.programs.gradientSubtract.bind();
        gl.uniform2f(this.programs.gradientSubtract.uniforms.texelSize, fbo.velocity.texelSizeX, fbo.velocity.texelSizeY);
        gl.uniform1i(this.programs.gradientSubtract.uniforms.uPressure, fbo.pressure.read.attach(0));
        gl.uniform1i(this.programs.gradientSubtract.uniforms.uVelocity, fbo.velocity.read.attach(1));
        this.blit(fbo.velocity.write);
        fbo.velocity.swap();

        // Advection
        this.programs.advection.bind();
        gl.uniform2f(this.programs.advection.uniforms.texelSize, fbo.velocity.texelSizeX, fbo.velocity.texelSizeY);
        let velocityId = fbo.velocity.read.attach(0);
        gl.uniform1i(this.programs.advection.uniforms.uVelocity, velocityId);
        gl.uniform1i(this.programs.advection.uniforms.uSource, velocityId);
        gl.uniform1f(this.programs.advection.uniforms.dt, dt);
        gl.uniform1f(this.programs.advection.uniforms.dissipation, config.VELOCITY_DISSIPATION);
        this.blit(fbo.velocity.write);
        fbo.velocity.swap();

        gl.uniform1i(this.programs.advection.uniforms.uVelocity, fbo.velocity.read.attach(0));
        gl.uniform1i(this.programs.advection.uniforms.uSource, fbo.dye.read.attach(1));
        gl.uniform1f(this.programs.advection.uniforms.dissipation, config.DENSITY_DISSIPATION);
        this.blit(fbo.dye.write);
        fbo.dye.swap();
    }

    render(target) {
        const gl = this.gl;
        const width = target == null ? gl.drawingBufferWidth : target.width;
        const height = target == null ? gl.drawingBufferHeight : target.height;
        this.displayMaterial.bind();
        if (this.config.SHADING) gl.uniform2f(this.displayMaterial.uniforms.texelSize, 1.0 / width, 1.0 / height);
        gl.uniform1i(this.displayMaterial.uniforms.uTexture, this.framebuffers.dye.read.attach(0));
        this.blit(target);
    }

    blit(target) {
        const gl = this.gl;
        if (!this.blitQuad) {
            gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
            this.blitQuad = true;
        }

        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);

        if (target == null) {
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        } else {
            gl.viewport(0, 0, target.width, target.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        }
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    // --- Inputs ---

    addEventListeners() {
        window.addEventListener('resize', () => {
            if (this.resizeCanvas()) this.initFramebuffers();
        });

        window.addEventListener('mousedown', this.handleMouseClick);
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('touchstart', this.handleTouchStart);
        window.addEventListener('touchmove', this.handleTouchMove);
    }

    handleMouseMove(e) {
        let pointer = this.pointers[0];
        let posX = this.scaleByPixelRatio(e.clientX);
        let posY = this.scaleByPixelRatio(e.clientY);
        // Use BLACK ink logic
        let color = this.generateInkColor();

        this.updatePointerMoveData(pointer, posX, posY, color);
        if (pointer.moved) {
            pointer.moved = false;
            this.splatPointer(pointer);
        }
    }

    handleMouseClick(e) {
        let pointer = this.pointers[0];
        let posX = this.scaleByPixelRatio(e.clientX);
        let posY = this.scaleByPixelRatio(e.clientY);
        this.updatePointerDownData(pointer, -1, posX, posY);
        // Burst of ink
        this.clickSplat(pointer);
    }

    handleTouchStart(e) {
        const touches = e.targetTouches;
        // Basic multi-touch logic or just first touch
        let pointer = this.pointers[0];
        if (touches.length > 0) {
            let posX = this.scaleByPixelRatio(touches[0].clientX);
            let posY = this.scaleByPixelRatio(touches[0].clientY);
            this.updatePointerDownData(pointer, touches[0].identifier, posX, posY);
            this.clickSplat(pointer);
        }
    }

    handleTouchMove(e) {
        const touches = e.targetTouches;
        let pointer = this.pointers[0];
        if (touches.length > 0) {
            let posX = this.scaleByPixelRatio(touches[0].clientX);
            let posY = this.scaleByPixelRatio(touches[0].clientY);
            let color = this.generateInkColor();
            this.updatePointerMoveData(pointer, posX, posY, color);
            if (pointer.moved) {
                pointer.moved = false;
                this.splatPointer(pointer);
            }
        }
    }

    updatePointerDownData(pointer, id, posX, posY) {
        pointer.id = id;
        pointer.down = true;
        pointer.moved = false;
        pointer.texcoordX = posX / this.canvas.width;
        pointer.texcoordY = 1.0 - posY / this.canvas.height;
        pointer.prevTexcoordX = pointer.texcoordX;
        pointer.prevTexcoordY = pointer.texcoordY;
        pointer.deltaX = 0;
        pointer.deltaY = 0;
        pointer.color = this.generateInkColor();
    }

    updatePointerMoveData(pointer, posX, posY, color) {
        pointer.prevTexcoordX = pointer.texcoordX;
        pointer.prevTexcoordY = pointer.texcoordY;
        pointer.texcoordX = posX / this.canvas.width;
        pointer.texcoordY = 1.0 - posY / this.canvas.height;
        pointer.deltaX = this.correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
        pointer.deltaY = this.correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
        pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
        pointer.color = color;
    }

    correctDeltaX(delta) {
        let aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio < 1) delta *= aspectRatio;
        return delta;
    }

    correctDeltaY(delta) {
        let aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio > 1) delta /= aspectRatio;
        return delta;
    }

    generateInkColor() {
        // Return values that create BLACK ink. 
        // In this simulation, color is additive light (RGB). 
        // To get black on transparent canvas, we might actually want dark colors to overlay?
        // Wait, the simulation assumes RGB. 
        // If we want black ink, we should probably output dark color and rely on alpha.
        // Or if the background is WHITE, we can subtract? 

        // This shader uses GL_ONE, GL_ONE_MINUS_SRC_ALPHA blending.
        // Source (ink) + Dest * (1 - inkAlpha).

        // Let's try deep grey/blueish ink:
        return { r: 50 / 255, g: 50 / 255, b: 60 / 255 };
    }

    splatPointer(pointer) {
        let dx = pointer.deltaX * this.config.SPLAT_FORCE;
        let dy = pointer.deltaY * this.config.SPLAT_FORCE;
        this.splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color);
    }

    clickSplat(pointer) {
        let color = this.generateInkColor();
        let dx = 10 * (Math.random() - 0.5);
        let dy = 30 * (Math.random() - 0.5);
        this.splat(pointer.texcoordX, pointer.texcoordY, dx, dy, color);
    }

    splat(x, y, dx, dy, color) {
        const gl = this.gl;
        this.programs.splat.bind();
        gl.uniform1i(this.programs.splat.uniforms.uTarget, this.framebuffers.velocity.read.attach(0));
        gl.uniform1f(this.programs.splat.uniforms.aspectRatio, this.canvas.width / this.canvas.height);
        gl.uniform2f(this.programs.splat.uniforms.point, x, y);
        gl.uniform3f(this.programs.splat.uniforms.color, dx, dy, 0.0);
        gl.uniform1f(this.programs.splat.uniforms.radius, this.correctRadius(this.config.SPLAT_RADIUS / 100.0));
        this.blit(this.framebuffers.velocity.write);
        this.framebuffers.velocity.swap();

        gl.uniform1i(this.programs.splat.uniforms.uTarget, this.framebuffers.dye.read.attach(0));
        gl.uniform3f(this.programs.splat.uniforms.color, color.r, color.g, color.b);
        this.blit(this.framebuffers.dye.write);
        this.framebuffers.dye.swap();
    }

    correctRadius(radius) {
        let aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio > 1) radius *= aspectRatio;
        return radius;
    }
}

// Helpers
class PointerPrototype {
    constructor() {
        this.id = -1;
        this.texcoordX = 0;
        this.texcoordY = 0;
        this.prevTexcoordX = 0;
        this.prevTexcoordY = 0;
        this.deltaX = 0;
        this.deltaY = 0;
        this.down = false;
        this.moved = false;
        this.color = { r: 0, g: 0, b: 0 };
    }
}

class GLProgram {
    constructor(gl, vertexShader, fragmentShader) {
        this.gl = gl;
        this.uniforms = {};
        this.program = gl.createProgram();
        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);
        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) console.trace(gl.getProgramInfoLog(this.program));

        let uniformCount = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < uniformCount; i++) {
            let uniformName = gl.getActiveUniform(this.program, i).name;
            this.uniforms[uniformName] = gl.getUniformLocation(this.program, uniformName);
        }
    }
    bind() {
        this.gl.useProgram(this.program);
    }
}

class Material {
    constructor(gl, vertexShader, fragmentShaderSource) {
        this.gl = gl;
        this.vertexShader = vertexShader;
        this.fragmentShaderSource = fragmentShaderSource;
        this.programs = [];
        this.activeProgram = null;
        this.uniforms = [];
    }
    setKeywords(keywords) {
        let hash = 0;
        for (let i = 0; i < keywords.length; i++) hash += this.hashCode(keywords[i]);
        let program = this.programs[hash];
        if (program == null) {
            let fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
            program = new GLProgram(this.gl, this.vertexShader, fragmentShader);
            this.programs[hash] = program;
        }
        if (program === this.activeProgram) return;
        this.uniforms = program.uniforms;
        this.activeProgram = program;
    }
    bind() {
        this.activeProgram.bind();
    }
    compileShader(type, source, keywords) {
        if (keywords) {
            let keywordsString = '';
            keywords.forEach(keyword => {
                keywordsString += '#define ' + keyword + '\n';
            });
            source = keywordsString + source;
        }
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) console.trace(this.gl.getShaderInfoLog(shader));
        return shader;
    }
    hashCode(s) {
        if (s.length === 0) return 0;
        let hash = 0;
        for (let i = 0; i < s.length; i++) {
            hash = (hash << 5) - hash + s.charCodeAt(i);
            hash |= 0;
        }
        return hash;
    }
}

// Instantiate globally so we can control it
window.fluidSim = new FluidSimulator();
