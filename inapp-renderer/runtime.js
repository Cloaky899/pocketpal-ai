(() => {
  const PROTOCOL_VERSION = 1;
  const state = {
    engine: null,
    scene: null,
    program: null,
    objects: new Map(),
    replacements: new Map(),
    status: 'idle',
    runId: null,
    sequence: 0,
    playing: false,
    disposed: false,
    frameCount: 0,
    droppedFrameCount: 0,
    runtimeErrorCount: 0,
    lastFrameTime: 0,
  };

  function send(type, payload = {}) {
    const message = {
      protocolVersion: PROTOCOL_VERSION,
      type,
      runId: state.runId,
      sequence: ++state.sequence,
      ...payload,
    };
    const serialized = JSON.stringify(message);
    if (window.ReactNativeWebView?.postMessage) {
      window.ReactNativeWebView.postMessage(serialized);
    } else {
      window.parent?.postMessage(message, '*');
    }
  }

  function fail(error, stage = 'runtime') {
    state.runtimeErrorCount += 1;
    state.status = 'failed';
    send('runtimeError', {
      stage,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  function point(value) {
    return [value[0], value[1], 0];
  }

  function colorOptions(primitive) {
    const options = {};
    if (primitive.color) options.color = primitive.color;
    if (primitive.fillOpacity !== undefined)
      options.fillOpacity = primitive.fillOpacity;
    return options;
  }

  function createPrimitive(primitive) {
    const engine = state.engine;
    const position = primitive.position || [0, 0];
    let object;
    switch (primitive.kind) {
      case 'text':
        object = new engine.Text({
          text: primitive.text,
          fontSize: primitive.fontSize,
          color: primitive.color,
        });
        break;
      case 'math':
        object = new engine.MathTex({
          tex: primitive.latex,
          fontSize: primitive.fontSize,
          color: primitive.color,
        });
        break;
      case 'circle':
        object = new engine.Circle({
          radius: primitive.radius,
          ...colorOptions(primitive),
        });
        break;
      case 'square':
        object = new engine.Square({
          sideLength: primitive.sideLength,
          ...colorOptions(primitive),
        });
        break;
      case 'rectangle':
        object = new engine.Rectangle({
          width: primitive.width,
          height: primitive.height,
          ...colorOptions(primitive),
        });
        break;
      case 'line':
        object = new engine.Line({
          start: point(primitive.start),
          end: point(primitive.end),
          color: primitive.color,
          strokeWidth: primitive.strokeWidth,
        });
        break;
      case 'arrow':
        object = new engine.Arrow({
          start: point(primitive.start),
          end: point(primitive.end),
          color: primitive.color,
          strokeWidth: primitive.strokeWidth,
        });
        break;
      case 'dot':
        object = new engine.Dot({
          point: point(position),
          radius: primitive.radius,
          color: primitive.color,
        });
        break;
      case 'axes':
        object = new engine.Axes({
          xRange: primitive.xRange,
          yRange: primitive.yRange,
          xLength: primitive.xLength,
          yLength: primitive.yLength,
          color: primitive.color,
        });
        break;
      case 'graph': {
        const functions = {
          sin: x => Math.sin(x),
          cos: x => Math.cos(x),
          tan: x => Math.tan(x),
          quadratic: x => x * x,
          linear: x => x,
          sqrt: x => Math.sqrt(Math.max(0, x)),
        };
        object = new engine.FunctionGraph({
          func: functions[primitive.expression],
          xRange: primitive.xRange,
          color: primitive.color,
          strokeWidth: primitive.strokeWidth,
        });
        break;
      }
      default:
        throw new Error(`Unsupported primitive kind: ${primitive.kind}`);
    }
    if (
      primitive.kind !== 'line' &&
      primitive.kind !== 'arrow' &&
      primitive.kind !== 'dot'
    ) {
      object.moveTo(point(position));
    }
    return object;
  }

  async function compile(program) {
    const started = performance.now();
    state.program = program;
    state.status = 'compiling';
    state.objects.clear();
    state.replacements.clear();
    if (state.scene) state.scene.dispose();
    const container = document.getElementById('scene');
    if (!container) throw new Error('Scene container is missing.');
    container.replaceChildren();
    state.scene = new state.engine.Scene(container, {
      width: program.aspectRatio === '9:16' ? 360 : 640,
      height:
        program.aspectRatio === '9:16'
          ? 640
          : program.aspectRatio === '1:1'
            ? 480
            : 360,
      backgroundColor: program.backgroundColor,
      targetFps: 60,
      autoRender: false,
      preserveDrawingBuffer: true,
    });
    const scene = program.scenes[0];
    if (!scene) throw new Error('Program contains no scene.');
    for (const primitive of scene.primitives) {
      const object = createPrimitive(primitive);
      state.objects.set(primitive.id, object);
      state.scene.add(object);
    }
    state.scene.render();
    state.status = 'ready';
    send('compileResult', {
      ok: true,
      compileMs: performance.now() - started,
      durationSeconds: scene.durationSeconds,
      objectCount: state.objects.size,
    });
  }

  function getObject(id) {
    const object = state.objects.get(id);
    if (!object) throw new Error(`Unknown runtime object: ${id}`);
    return object;
  }

  async function playAnimation(animation) {
    if (animation.kind === 'wait') {
      await state.scene.wait(animation.durationSeconds);
      return;
    }
    const object = getObject(animation.targetId);
    const options = {runTime: animation.durationSeconds};
    switch (animation.kind) {
      case 'create':
        await state.scene.play(new state.engine.Create(object, options));
        return;
      case 'write':
        await state.scene.play(new state.engine.Write(object, options));
        return;
      case 'fade-in':
        await state.scene.play(new state.engine.FadeIn(object, options));
        return;
      case 'fade-out':
        await state.scene.play(new state.engine.FadeOut(object, options));
        return;
      case 'transform': {
        const replacement = getObject(animation.replacementId);
        await state.scene.play(
          new state.engine.Transform(object, replacement, options),
        );
        return;
      }
      case 'move-to':
        await state.scene.play(
          new state.engine.ApplyMethod(
            object,
            'moveTo',
            point(animation.position),
            options,
          ),
        );
        return;
      case 'shift':
        await state.scene.play(
          new state.engine.ApplyMethod(
            object,
            'shift',
            point(animation.position),
            options,
          ),
        );
        return;
      case 'rotate':
        await state.scene.play(
          new state.engine.Rotate(object, animation.angleRadians, options),
        );
        return;
      case 'scale':
        await state.scene.play(
          new state.engine.ScaleInPlace(object, animation.factor, options),
        );
        return;
      default:
        throw new Error(`Unsupported animation kind: ${animation.kind}`);
    }
  }

  async function play() {
    if (!state.scene || !state.program) throw new Error('No compiled scene.');
    const scene = state.program.scenes[0];
    state.status = 'rendering';
    state.playing = true;
    state.frameCount = 0;
    state.lastFrameTime = performance.now();
    const tick = () => {
      if (!state.playing) return;
      const now = performance.now();
      if (now - state.lastFrameTime > 34) state.droppedFrameCount += 1;
      state.lastFrameTime = now;
      state.frameCount += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    for (const animation of scene.animations) {
      if (!state.playing) break;
      await playAnimation(animation);
    }
    state.playing = false;
    state.status = 'paused';
    send('renderResult', {
      ok: true,
      currentTime: state.scene.currentTime,
      metrics: {
        compileMs: 0,
        firstFrameMs: 0,
        frameCount: state.frameCount,
        droppedFrameCount: state.droppedFrameCount,
        runtimeErrorCount: state.runtimeErrorCount,
      },
    });
  }

  function seek(time) {
    if (!state.scene) throw new Error('No compiled scene.');
    state.scene.seek(Math.max(0, time));
    send('frameResult', {ok: true, currentTime: state.scene.currentTime});
  }

  function captureFrame() {
    if (!state.scene) throw new Error('No compiled scene.');
    const canvas = state.scene.renderer.getCanvas();
    send('frameResult', {
      ok: true,
      currentTime: state.scene.currentTime,
      dataUrl: canvas.toDataURL('image/png'),
    });
  }

  function dispose() {
    state.playing = false;
    state.scene?.dispose();
    state.engine = null;
    state.scene = null;
    state.program = null;
    state.objects.clear();
    state.status = 'disposed';
    send('disposed', {ok: true});
  }

  async function handle(message) {
    if (!message || message.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error('Unsupported renderer protocol version.');
    }
    state.runId = message.runId || state.runId;
    switch (message.type) {
      case 'loadProgram':
        await compile(message.bundle);
        return;
      case 'play':
        await play();
        return;
      case 'pause':
        state.playing = false;
        state.scene?.pause();
        state.status = 'paused';
        send('status', {status: state.status});
        return;
      case 'seek':
        seek(message.time);
        return;
      case 'captureFrame':
        captureFrame();
        return;
      case 'dispose':
        dispose();
        return;
      default:
        throw new Error(`Unknown renderer message: ${message.type}`);
    }
  }

  window.addEventListener('message', event => {
    Promise.resolve(handle(event.data)).catch(error => fail(error, 'bridge'));
  });
  document.addEventListener('message', event => {
    Promise.resolve(handle(JSON.parse(event.data))).catch(error =>
      fail(error, 'bridge'),
    );
  });

  window.__POCKETPAL_BOOTSTRAP__ = async function bootstrap(engineSource) {
    try {
      state.engine = await import(
        `data:text/javascript;charset=utf-8,${encodeURIComponent(engineSource)}`
      );
      send('ready', {engine: 'manim-web', engineVersion: '0.3.24'});
    } catch (error) {
      fail(error, 'bootstrap');
    }
  };
})();
