import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const params = {
  timeScale: 1.2,
  rotationSpeedX: 0.002,
  rotationSpeedY: 0.005,
  plasmaScale: 0.2,
  plasmaBrightness: 1.31,
  voidThreshold: 0.09,
  colorDeep: 0x001433,
  colorMid: 0x0084ff,
  colorBright: 0x00ffe1,
  shellColor: 0x0066ff,
  shellOpacity: 0.41,
};

const AIVoiceBlob = ({ blobConfig = {}, setBlobConfig }) => {
  const mountRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const reqRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  
  const plasmaMatRef = useRef(null);
  const shellFrontMatRef = useRef(null);
  const shellBackMatRef = useRef(null);
  const configRef = useRef(blobConfig);
  
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    configRef.current = blobConfig;
    if (plasmaMatRef.current && shellFrontMatRef.current && shellBackMatRef.current) {
       const userColor = new THREE.Color(blobConfig.color);
       plasmaMatRef.current.uniforms.uColorBright.value.copy(userColor);
       plasmaMatRef.current.uniforms.uColorMid.value.copy(userColor.clone().multiplyScalar(0.6));
       plasmaMatRef.current.uniforms.uColorDeep.value.copy(userColor.clone().multiplyScalar(0.2));
       shellFrontMatRef.current.uniforms.uColor.value.copy(userColor);
       const deepColor = userColor.clone().multiplyScalar(0.4);
       shellBackMatRef.current.uniforms.uColor.value.copy(deepColor);
    }
  }, [blobConfig]);

  const startMicrophone = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8; // Smooths out the audio signal
      
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      
      streamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch (error) {
      console.error("Microphone access denied or error occurred. The AI blob will not pulse to your voice, but voice commands may still work:", error);
      // Removed the alert() that was blocking the UI
    }
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Automatically start listening on mount
    startMicrophone();

    // 1. SCENE SETUP
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.z = 2.4;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1.5;
    controls.maxDistance = 20;

    const mainGroup = new THREE.Group();
    scene.add(mainGroup);

    // --- GLSL NOISE FUNCTIONS ---
    const noiseFunctions = `
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
      vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

      float snoise(vec3 v) {
        const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
        const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy) );
        vec3 x0 = v - i + dot(i, C.xxx) ;
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min( g.xyz, l.zxy );
        vec3 i2 = max( g.xyz, l.zxy );
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        i = mod289(i);
        vec4 p = permute( permute( permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
        float n_ = 0.142857142857;
        vec3  ns = n_ * D.wyz - D.xzx;
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_ );
        vec4 x = x_ *ns.x + ns.yyyy;
        vec4 y = y_ *ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        vec4 b0 = vec4( x.xy, y.xy );
        vec4 b1 = vec4( x.zw, y.zw );
        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
        vec3 p0 = vec3(a0.xy,h.x);
        vec3 p1 = vec3(a0.zw,h.y);
        vec3 p2 = vec3(a1.xy,h.z);
        vec3 p3 = vec3(a1.zw,h.w);
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
      }

      float fbm(vec3 p) {
        float total = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;
        for (int i = 0; i < 3; i++) { 
          total += snoise(p * frequency) * amplitude;
          amplitude *= 0.5;
          frequency *= 2.0;
        }
        return total;
      }
    `;

    // 2. LIGHTS
    const pointLight = new THREE.PointLight(0x0088ff, 2.0, 10);
    mainGroup.add(pointLight);

    // 3. OUTER SHELL (Glass)
    const shellGeo = new THREE.SphereGeometry(1.0, 64, 64);
    const shellShader = {
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        uniform float uTime;
        uniform float uAudio;
        ${noiseFunctions}
        void main() {
          vNormal = normalize(normalMatrix * normal);
          float wave = fbm(position * 3.0 + uTime * 2.0) * uAudio * 0.6;
          vec3 newPos = position + normal * wave;
          vec4 mvPosition = modelViewMatrix * vec4(newPos, 1.0);
          vViewPosition = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        uniform vec3 uColor;
        uniform float uOpacity;
        
        void main() {
          float fresnel = pow(1.0 - dot(normalize(vNormal), normalize(vViewPosition)), 2.5);
          gl_FragColor = vec4(uColor, fresnel * uOpacity);
        }
      `
    };

    const shellBackMat = new THREE.ShaderMaterial({
      vertexShader: shellShader.vertexShader,
      fragmentShader: shellShader.fragmentShader,
      uniforms: { 
        uColor: { value: new THREE.Color(0x000055) }, 
        uOpacity: { value: 0.3 },
        uTime: { value: 0 },
        uAudio: { value: 0 }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false
    });

    const shellFrontMat = new THREE.ShaderMaterial({
      vertexShader: shellShader.vertexShader,
      fragmentShader: shellShader.fragmentShader,
      uniforms: { 
        uColor: { value: new THREE.Color(params.shellColor) }, 
        uOpacity: { value: params.shellOpacity },
        uTime: { value: 0 },
        uAudio: { value: 0 }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      depthWrite: false
    });

    mainGroup.add(new THREE.Mesh(shellGeo, shellBackMat));
    mainGroup.add(new THREE.Mesh(shellGeo, shellFrontMat));

    // 4. PLASMA (Gas)
    const plasmaGeo = new THREE.SphereGeometry(0.998, 128, 128); 
    const plasmaMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAudio: { value: 0 },
        uScale: { value: params.plasmaScale },
        uBrightness: { value: params.plasmaBrightness },
        uThreshold: { value: params.voidThreshold },
        uColorDeep: { value: new THREE.Color(params.colorDeep) },
        uColorMid: { value: new THREE.Color(params.colorMid) },
        uColorBright: { value: new THREE.Color(params.colorBright) }
      },
      vertexShader: `
        varying vec3 vPosition;
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        uniform float uTime;
        uniform float uAudio;
        ${noiseFunctions}

        void main() {
          vNormal = normalize(normalMatrix * normal);
          float wave = fbm(position * 3.0 + uTime * 2.0) * uAudio * 0.6;
          vec3 newPos = position + normal * wave;

          vPosition = newPos;
          vec4 mvPosition = modelViewMatrix * vec4(newPos, 1.0);
          vViewPosition = -mvPosition.xyz; 
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uScale;
        uniform float uBrightness;
        uniform float uThreshold;
        uniform vec3 uColorDeep;
        uniform vec3 uColorMid;
        uniform vec3 uColorBright;

        varying vec3 vPosition;
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        
        ${noiseFunctions}

        void main() {
          vec3 p = vPosition * uScale; 
          
          vec3 q = vec3(
            fbm(p + vec3(0.0, uTime * 0.05, 0.0)),
            fbm(p + vec3(5.2, 1.3, 2.8) + uTime * 0.05),
            fbm(p + vec3(2.2, 8.4, 0.5) - uTime * 0.02)
          );
          
          float density = fbm(p + 2.0 * q);
          float t = (density + 0.4) * 0.8;
          float alpha = smoothstep(uThreshold, 0.7, t);

          vec3 cWhite = vec3(1.0, 1.0, 1.0);
          
          vec3 color = mix(uColorDeep, uColorMid, smoothstep(uThreshold, 0.5, t));
          color = mix(color, uColorBright, smoothstep(0.5, 0.8, t));
          color = mix(color, cWhite, smoothstep(0.8, 1.0, t));

          float facing = dot(normalize(vNormal), normalize(vViewPosition));
          float depthFactor = (facing + 1.0) * 0.5;
          float finalAlpha = alpha * (0.02 + 0.98 * depthFactor);
          
          gl_FragColor = vec4(color * uBrightness, finalAlpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    shellBackMatRef.current = shellBackMat;
    shellFrontMatRef.current = shellFrontMat;
    plasmaMatRef.current = plasmaMat;

    if (configRef.current.color) {
      const initColor = new THREE.Color(configRef.current.color);
      plasmaMat.uniforms.uColorBright.value.copy(initColor);
      plasmaMat.uniforms.uColorMid.value.copy(initColor.clone().multiplyScalar(0.6));
      plasmaMat.uniforms.uColorDeep.value.copy(initColor.clone().multiplyScalar(0.2));
      shellFrontMat.uniforms.uColor.value.copy(initColor);
      shellBackMat.uniforms.uColor.value.copy(initColor.clone().multiplyScalar(0.4));
    }

    const plasmaMesh = new THREE.Mesh(plasmaGeo, plasmaMat);
    mainGroup.add(plasmaMesh);

    // 5. PARTICLES
    const pCount = 600; 
    const pPos = new Float32Array(pCount * 3);
    const pSizes = new Float32Array(pCount);
    const sphereRadius = 0.95;

    for(let i = 0; i < pCount; i++) {
      const r = sphereRadius * Math.cbrt(Math.random());
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      
      pPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pPos[i * 3 + 2] = r * Math.cos(phi);
      pSizes[i] = Math.random();
    }

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSizes, 1));

    const pMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xffffff) }
      },
      vertexShader: `
        uniform float uTime;
        attribute float aSize;
        varying float vAlpha;
        
        void main() {
          vec3 pos = position;
          pos.y += sin(uTime * 0.2 + pos.x) * 0.02;
          pos.x += cos(uTime * 0.15 + pos.z) * 0.02;

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          
          float baseSize = 8.0 * aSize + 4.0;
          gl_PointSize = baseSize * (1.0 / -mvPosition.z);
          vAlpha = 0.8 + 0.2 * sin(uTime + aSize * 10.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float dist = length(uv);
          if(dist > 0.5) discard;
          
          float glow = 1.0 - (dist * 2.0);
          glow = pow(glow, 1.8);
          
          gl_FragColor = vec4(uColor, glow * vAlpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const particles = new THREE.Points(pGeo, pMat);
    mainGroup.add(particles);

    // 6. ANIMATION LOOP WITH AUDIO REACTIVITY
    const clock = new THREE.Clock();
    const targetScaleVector = new THREE.Vector3(1, 1, 1);

    const animate = () => {
      reqRef.current = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      // Audio Processing
      let volume = 0;
      if (analyserRef.current && dataArrayRef.current) {
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        let sum = 0;
        for (let i = 0; i < dataArrayRef.current.length; i++) {
          sum += dataArrayRef.current[i];
        }
        // Calculate average volume (0 to 255)
        volume = sum / dataArrayRef.current.length;
      }

      // Add simulated volume from Terminal.js (for when Jarvis speaks or when mic stream fails)
      if (window.simulatedBlobVolumeTarget > 0) {
        const time = Date.now() / 150; // Slower, smoother sine wave 
        const simulatedVol = window.simulatedBlobVolumeTarget + (Math.sin(time) * 15); // gentle pulsing, no random jitter
        volume = Math.max(volume, simulatedVol);
      }

      // Dynamic config usage
      const currentConfig = configRef.current;
      controls.enabled = !currentConfig.isDraggingMode;

      // Lowered sensitivity for smoother visuals
      const sensitivity = Math.pow((volume / 255), 1.5) * (currentConfig.sensitivity || 0.8) * 1.5; 
      
      // Target audio value for wavy vertex displacement with a slower lerp (0.1 instead of 0.2)
      plasmaMat.uniforms.uAudio.value += (sensitivity - plasmaMat.uniforms.uAudio.value) * 0.1;
      shellFrontMat.uniforms.uAudio.value = plasmaMat.uniforms.uAudio.value;
      shellBackMat.uniforms.uAudio.value = plasmaMat.uniforms.uAudio.value;
      
      // Calculate scale factoring in the dynamic size config
      const scaleBump = (currentConfig.size || 1.0) + sensitivity * 0.2;
      targetScaleVector.set(scaleBump, scaleBump, scaleBump);
      mainGroup.scale.lerp(targetScaleVector, 0.2);

      // Make the brightness dynamically react to audio as well
      const targetBrightness = params.plasmaBrightness + sensitivity * 1.5;
      plasmaMat.uniforms.uBrightness.value += (targetBrightness - plasmaMat.uniforms.uBrightness.value) * 0.1;

      // Update uniforms
      plasmaMat.uniforms.uTime.value = t * params.timeScale; 
      shellFrontMat.uniforms.uTime.value = t * params.timeScale;
      shellBackMat.uniforms.uTime.value = t * params.timeScale;
      pMat.uniforms.uTime.value = t;

      // Rotation
      plasmaMesh.rotation.y = t * 0.08;
      mainGroup.rotation.x += params.rotationSpeedX;
      mainGroup.rotation.y += params.rotationSpeedY;

      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    // Handle Resize
    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup on unmount
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(reqRef.current);
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      // Dispose materials & geometries to prevent memory leaks
      shellGeo.dispose();
      shellBackMat.dispose();
      shellFrontMat.dispose();
      plasmaGeo.dispose();
      plasmaMat.dispose();
      pGeo.dispose();
      pMat.dispose();
      renderer.dispose();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, [startMicrophone]);

  // Global Drag Handlers
  useEffect(() => {
    const handleGlobalMouseMove = (e) => {
      if (!isDragging || !blobConfig.isDraggingMode) return;
      setBlobConfig(prev => ({
        ...prev,
        position: {
          x: e.clientX - dragOffset.current.x,
          y: e.clientY - dragOffset.current.y
        }
      }));
    };
    const handleGlobalMouseUp = () => setIsDragging(false);
    
    if (isDragging) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, blobConfig.isDraggingMode, setBlobConfig]);

  const handleMouseDown = (e) => {
    if (!blobConfig.isDraggingMode) return;
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - blobConfig.position.x,
      y: e.clientY - blobConfig.position.y
    };
  };

  const currentX = blobConfig.position?.x || window.innerWidth / 2;
  const currentY = blobConfig.position?.y || window.innerHeight / 2;

  return (
    <div 
      onMouseDown={handleMouseDown}
      style={{ 
        position: 'absolute', 
        left: currentX, 
        top: currentY,
        transform: 'translate(-50%, -50%)',
        width: '600px', 
        height: '600px', 
        backgroundColor: 'transparent', 
        pointerEvents: blobConfig.isDraggingMode ? 'auto' : 'none',
        cursor: blobConfig.isDraggingMode ? 'grab' : 'default',
        zIndex: blobConfig.isDraggingMode ? 10000 : 5,
        border: blobConfig.isDraggingMode ? '2px dashed rgba(0, 255, 225, 0.6)' : 'none',
        borderRadius: '50%',
        transition: isDragging ? 'none' : 'left 0.1s, top 0.1s'
      }}
    >
      {/* ThreeJS Canvas Mount Point */}
      <div ref={mountRef} style={{ width: '100%', height: '100%', pointerEvents: blobConfig.isDraggingMode ? 'none' : 'auto' }} />
    </div>
  );
};

export default AIVoiceBlob;
