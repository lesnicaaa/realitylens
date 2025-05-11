// RealityLens - Main application logic
const infoElement = document.getElementById('info');
let hasDeviceMotion = false;
let hasDeviceOrientation = false;

// Sensor update rate detection
let orientationUpdateCount = 0;
let lastOrientationRateUpdate = 0;
let orientationUpdateRate = 0;

// Camera information
let selectedCameraLabel = "Unknown Camera";

// Environment utility object
const EnvUtil = {
    isIos: /iPhone|iPad|iPod/i.test(navigator.userAgent),
    isAndroid: /Android/i.test(navigator.userAgent),
    isDesktop: !(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)),
    iosVersion: function() {
        const match = navigator.userAgent.match(/OS (\d+)_(\d+)_?(\d+)?/);
        return match ? parseFloat(match[1] + '.' + match[2]) : 0;
    }
};

// Three.js scene initialization
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ 
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: false
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for better performance
document.getElementById('arContainer').appendChild(renderer.domElement);

// Create cube
const cubeSize = 0.2;
const geometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
const materials = [
    new THREE.MeshBasicMaterial({ color: 0xff0000 }), // right
    new THREE.MeshBasicMaterial({ color: 0x00ff00 }), // left
    new THREE.MeshBasicMaterial({ color: 0x0000ff }), // top
    new THREE.MeshBasicMaterial({ color: 0xffff00 }), // bottom
    new THREE.MeshBasicMaterial({ color: 0xff00ff }), // front
    new THREE.MeshBasicMaterial({ color: 0x00ffff })  // back
];
const cube = new THREE.Mesh(geometry, materials);
// Place the cube in a fixed position in world coordinates, 1 meter in front of the camera
cube.position.set(0, 0, -1);
scene.add(cube);

// Add helper objects (axes) to aid in understanding spatial relationships
const axesHelper = new THREE.AxesHelper(0.5);
scene.add(axesHelper);

// Add lighting (although BasicMaterial doesn't need light, but for future expansion)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(1, 1, 1);
scene.add(directionalLight);

// Create sensor rate display element
const rateInfoElement = document.createElement('div');
rateInfoElement.style.position = 'absolute';
rateInfoElement.style.top = '10px';
rateInfoElement.style.right = '10px';
rateInfoElement.style.background = 'rgba(0, 0, 0, 0.5)';
rateInfoElement.style.color = 'white';
rateInfoElement.style.padding = '10px';
rateInfoElement.style.borderRadius = '5px';
rateInfoElement.style.fontFamily = 'Arial, sans-serif';
rateInfoElement.style.fontSize = '14px';
rateInfoElement.style.zIndex = '100';
rateInfoElement.style.maxWidth = '300px';
rateInfoElement.style.wordWrap = 'break-word';
rateInfoElement.textContent = 'Sensor: 0 Hz';
document.getElementById('arContainer').appendChild(rateInfoElement);

// Video texture creation
let video, videoTexture;
let lastTimestamp = 0;
const FPS_TARGET = 30; // Target framerate, doesn't need to be too high on mobile devices

// Device orientation controller
let controls;

/**
 * Device Orientation Controller class
 * @param {THREE.Object3D} object - The 3D object to control
 */
THREE.DeviceOrientationControls = function(object) {
    let scope = this;
    
    this.object = object;
    this.object.rotation.reorder("YXZ");
    
    this.enabled = true;
    this.deviceOrientation = {};
    this.screenOrientation = 0;
    this.alphaOffset = 0; // For calibration
    
    // Device orientation event handler
    function onDeviceOrientationChangeEvent(event) {
        scope.deviceOrientation = event;
        
        // Update sensor rate counter
        orientationUpdateCount++;
        
        // Get and display sensor data
        if (event.alpha !== null && event.beta !== null && event.gamma !== null) {
            hasDeviceOrientation = true;
            if (infoElement) {
                infoElement.textContent = `α:${Math.round(event.alpha)}° β:${Math.round(event.beta)}° γ:${Math.round(event.gamma)}°`;
            }
        } else {
            hasDeviceOrientation = false;
        }
    }
    
    // Screen orientation change event handler
    function onScreenOrientationChangeEvent() {
        scope.screenOrientation = window.orientation || 0;
    }
    
    // Coordinate system conversion function
    const setObjectQuaternion = function() {
        const zee = new THREE.Vector3(0, 0, 1);
        const euler = new THREE.Euler();
        const q0 = new THREE.Quaternion();
        const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 around x-axis
        
        return function(quaternion, alpha, beta, gamma, orient) {
            // Apply Euler angles
            euler.set(beta, alpha, -gamma, 'YXZ');
            
            // Set quaternion based on Euler angles
            quaternion.setFromEuler(euler);
            
            // Adjust view direction (camera facing device back instead of top)
            quaternion.multiply(q1);
            
            // Adjust for screen orientation
            quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
        };
    }();
    
    // Connect event listeners
    this.connect = function() {
        onScreenOrientationChangeEvent(); // Initialize screen orientation
        
        window.addEventListener('orientationchange', onScreenOrientationChangeEvent, false);
        window.addEventListener('deviceorientation', onDeviceOrientationChangeEvent, false);
        
        this.enabled = true;
        return this;
    };
    
    // Disconnect event listeners
    this.disconnect = function() {
        window.removeEventListener('orientationchange', onScreenOrientationChangeEvent, false);
        window.removeEventListener('deviceorientation', onDeviceOrientationChangeEvent, false);
        
        this.enabled = false;
        return this;
    };
    
    // Update object attitude
    this.update = function() {
        if (!this.enabled) return;
        
        const device = scope.deviceOrientation;
        
        if (device) {
            const alpha = device.alpha ? THREE.MathUtils.degToRad(device.alpha) + scope.alphaOffset : 0;
            const beta = device.beta ? THREE.MathUtils.degToRad(device.beta) : 0;
            const gamma = device.gamma ? THREE.MathUtils.degToRad(device.gamma) : 0;
            const orient = scope.screenOrientation ? THREE.MathUtils.degToRad(scope.screenOrientation) : 0;
            
            // Update camera orientation
            setObjectQuaternion(scope.object.quaternion, alpha, beta, gamma, orient);
        }
    };
    
    // Calibrate orientation
    this.calibrate = function() {
        if (this.deviceOrientation && this.deviceOrientation.alpha) {
            this.alphaOffset = -THREE.MathUtils.degToRad(this.deviceOrientation.alpha);
        }
        return this;
    };
    
    // Reset cube position
    this.resetCubePosition = function(cube) {
        if (!cube) return this;
        
        // Calculate position 1 meter in front of camera
        const vector = new THREE.Vector3(0, 0, -1);
        vector.applyQuaternion(this.object.quaternion);
        vector.multiplyScalar(1); // 1 meter distance
        
        // Set cube position
        cube.position.copy(vector);
        
        return this;
    };
    
    this.connect();
};

/**
 * Get basic camera permission first to ensure complete device list
 * Solves the problem of some browsers not providing complete device label information before authorization
 */
async function getDevicePermission() {
    try {
        infoElement.textContent = 'Getting basic camera permission...';
        
        // Use simplest constraints to get permission
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: false, 
            video: true 
        });
        
        // Close stream immediately
        stream.getTracks().forEach(track => track.stop());
        
        // Get updated device list
        const devices = await navigator.mediaDevices.enumerateDevices();
        console.log('Device list after permission', devices);
        
        infoElement.textContent = 'Camera permission granted, selecting best camera...';
        return devices;
    } catch (error) {
        console.error('Failed to get device permission:', error);
        infoElement.textContent = 'Unable to get basic camera permission';
        throw error;
    }
}

/**
 * Get best rear camera
 * Intelligently select the most appropriate rear camera on different devices
 */
async function getBestRearCamera() {
    try {
        let preferredCameraId;
        let cameraLabel = "Default Camera";
        
        // Get basic permission first to ensure complete device list
        await getDevicePermission();
        
        // Get complete device list
        const devices = await navigator.mediaDevices.enumerateDevices();
        console.log('Available devices:', devices);
        
        // Filter valid video input devices
        const validVideoDevices = devices.filter(e => e.kind === 'videoinput' && e.deviceId !== '');
        console.log('Video devices:', validVideoDevices.map(i => i.label));
        
        // Select appropriate rear camera based on different device characteristics
        if (!EnvUtil.isIos || EnvUtil.iosVersion() < 16.3) {
            // Android: camera2 0 common on Huawei, OPPO, vivo rear cameras
            // device/0 common on some Huawei devices rear cameras
            const findCamera20 = validVideoDevices.find(
                e => (e.label.includes('camera2 0') || e.label.includes('device/0')) && 
                     e.label.includes('facing back')
            );
            
            if (findCamera20) {
                preferredCameraId = findCamera20.deviceId;
                cameraLabel = findCamera20.label;
            } else if (validVideoDevices.length > 2) {
                // If multiple cameras, usually the last one is the main rear camera
                const lastCamera = validVideoDevices[validVideoDevices.length - 1];
                preferredCameraId = lastCamera.deviceId;
                cameraLabel = lastCamera.label;
            }
        } else {
            // iOS: directly search for "Back Camera"
            const backCameras = validVideoDevices.filter(
                e => e.label === '后置相机' || e.label === 'Back Camera'
            );
            
            if (backCameras.length > 0) {
                preferredCameraId = backCameras[0].deviceId;
                cameraLabel = backCameras[0].label;
            }
        }
        
        console.log('Selected camera:', cameraLabel);
        console.log('Selected camera ID:', preferredCameraId);
        
        // Save selected camera label
        selectedCameraLabel = cameraLabel;
        
        // Update information display
        updateInfoDisplay();
        
        // Build camera configuration options
        const options = {
            video: {
                width: { ideal: window.innerHeight },
                height: { ideal: window.innerWidth },
                frameRate: { max: 30 },
                facingMode: EnvUtil.isDesktop ? 'environment' : { exact: 'environment' },
                deviceId: preferredCameraId ? { exact: preferredCameraId } : undefined
            },
            audio: false
        };
        
        return navigator.mediaDevices.getUserMedia(options);
    } catch (error) {
        // If specified device ID fails, try using default device
        if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
            console.log('Specified camera failed, trying default camera');
            selectedCameraLabel = "Default Back Camera (fallback)";
            updateInfoDisplay();
            
            return navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: window.innerHeight },
                    height: { ideal: window.innerWidth },
                    frameRate: { max: 30 },
                    facingMode: EnvUtil.isDesktop ? 'environment' : { exact: 'environment' }
                },
                audio: false
            });
        }
        return Promise.reject(new Error('[Camera Error] ' + error.message));
    }
}

// Update information display
function updateInfoDisplay() {
    // First show camera info
    rateInfoElement.innerHTML = `Camera: ${selectedCameraLabel}<br>Sensor: ${orientationUpdateRate} Hz`;
    
    // Show device type and model information
    const deviceInfo = EnvUtil.isIos ? 
        `iOS ${EnvUtil.iosVersion()}` : 
        (EnvUtil.isAndroid ? 'Android' : 'Desktop');
        
    rateInfoElement.innerHTML += `<br>${deviceInfo}`;
    
    // Add device information
    if (navigator.userAgent) {
        const deviceMatch = navigator.userAgent.match(/\(([^)]+)\)/);
        if (deviceMatch && deviceMatch[1]) {
            const deviceModel = deviceMatch[1].split(';')[0].trim();
            if (deviceModel) {
                rateInfoElement.innerHTML += ` | ${deviceModel}`;
            }
        }
    }
}

// Initialize AR application
async function initAR() {
    infoElement.textContent = 'Initializing AR...';
    
    try {
        // Get camera permission using optimized camera selection logic
        const stream = await getBestRearCamera();
        
        // Create video element and set as background
        setupVideoBackground(stream);
        
        // Initialize device orientation controls
        initOrientationControls();
        
        // Start sensor update rate detection
        startOrientationRateDetection();
        
        infoElement.textContent = 'Move device to see AR';
    } catch (error) {
        // If rear camera access fails, try using any available camera
        try {
            console.error('Rear camera initialization failed:', error);
            infoElement.textContent = 'Trying front camera...';
            
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true
            });
            selectedCameraLabel = "Front Camera (fallback)";
            updateInfoDisplay();
            
            setupVideoBackground(stream);
            initOrientationControls();
            startOrientationRateDetection();
            infoElement.textContent = 'Using front camera (rear camera unavailable)';
        } catch (fallbackError) {
            infoElement.textContent = `AR initialization failed: ${error.message}`;
            console.error('AR initialization failed', error, fallbackError);
        }
    }
}

// Start sensor update rate detection
function startOrientationRateDetection() {
    // Reset counter
    orientationUpdateCount = 0;
    lastOrientationRateUpdate = performance.now();
    
    // Periodically update sensor rate display
    setInterval(updateOrientationRate, 1000);
}

// Update sensor update rate display
function updateOrientationRate() {
    const now = performance.now();
    const elapsedSeconds = (now - lastOrientationRateUpdate) / 1000;
    
    if (elapsedSeconds > 0) {
        // Calculate updates per second
        orientationUpdateRate = Math.round(orientationUpdateCount / elapsedSeconds);
        
        // Update display
        updateInfoDisplay();
        
        // Reset counter
        orientationUpdateCount = 0;
        lastOrientationRateUpdate = now;
    }
}

// Set up video background
function setupVideoBackground(stream) {
    // Create video element
    video = document.createElement('video');
    video.srcObject = stream;
    video.playsInline = true; // Important: allows inline playback
    video.muted = true;
    video.autoplay = true;
    video.setAttribute('playsinline', ''); // Double ensure iOS inline playback
    video.setAttribute('webkit-playsinline', ''); // For older iOS versions
    video.setAttribute('muted', ''); // Ensure muted state for autoplay
    video.style.position = 'absolute';
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    video.style.top = '0';
    video.style.left = '0';
    video.style.zIndex = '-1'; // Put behind Three.js canvas
    document.getElementById('arContainer').appendChild(video);
    
    // iOS Safari specific fix - add additional user interaction to ensure video plays
    let playAttempts = 0;
    const maxPlayAttempts = 5;
    
    const attemptToPlay = () => {
        playAttempts++;
        console.log(`Play attempt ${playAttempts}`);
        
        // Try playing the video
        const playPromise = video.play();
        
        if (playPromise !== undefined) {
            playPromise.then(() => {
                console.log('Video playback started successfully');
                // Ensure video is visible
                setTimeout(() => {
                    if (EnvUtil.isIos) {
                        // Force repaint on iOS
                        video.style.display = 'none';
                        setTimeout(() => {
                            video.style.display = 'block';
                        }, 10);
                    }
                }, 100);
            }).catch(e => {
                console.error('Auto-play failed:', e);
                
                // If we've tried too many times, show user instructions
                if (playAttempts >= maxPlayAttempts) {
                    infoElement.textContent = 'Tap to start camera';
                    
                    // Setup global tap handler as last resort
                    document.body.addEventListener('click', () => {
                        video.play().catch(err => {
                            console.error('Manual play failed:', err);
                            infoElement.textContent = 'Camera permission issue. Try reloading.';
                        });
                    }, { once: true });
                    
                    return;
                }
                
                // Try again after a delay
                setTimeout(attemptToPlay, 200 * playAttempts);
            });
        } else {
            // Older browsers might not return a promise
            if (playAttempts >= maxPlayAttempts) {
                infoElement.textContent = 'Tap to start camera';
                
                document.body.addEventListener('click', () => {
                    video.play();
                }, { once: true });
            } else {
                setTimeout(attemptToPlay, 200 * playAttempts);
            }
        }
    };
    
    // Ensure video is loaded and starts playing
    video.addEventListener('loadedmetadata', () => {
        console.log('Video metadata loaded');
        attemptToPlay();
    });
    
    // Add additional listener in case loadedmetadata doesn't fire
    setTimeout(() => {
        if (playAttempts === 0) {
            console.log('Delayed play attempt');
            attemptToPlay();
        }
    }, 1000);
}

// Initialize device orientation controls
function initOrientationControls() {
    if (!controls) {
        // Create and initialize controller
        controls = new THREE.DeviceOrientationControls(camera);
    }
    
    // Detect device motion API
    if (window.DeviceMotionEvent) {
        window.addEventListener('devicemotion', onDeviceMotionChange, false);
    }
}

// Device motion change handler
function onDeviceMotionChange(event) {
    hasDeviceMotion = true;
    
    // Check if gravity data exists
    if (!event.accelerationIncludingGravity || 
        (!event.accelerationIncludingGravity.x && 
         !event.accelerationIncludingGravity.y && 
         !event.accelerationIncludingGravity.z)) {
        hasDeviceMotion = false;
    }
}

// Screen size adjustment
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for better performance
}

// Initialize request device orientation permission (for iOS 13+)
function requestOrientationPermission() {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iOS 13+
        DeviceOrientationEvent.requestPermission()
            .then(response => {
                if (response === 'granted') {
                    initOrientationControls();
                    startOrientationRateDetection();
                    infoElement.textContent = 'Move device to see AR';
                } else {
                    infoElement.textContent = 'Permission needed for AR';
                }
            })
            .catch(error => {
                infoElement.textContent = `Permission error: ${error.message}`;
                console.error('Failed to request device orientation permission', error);
            });
    }
}

// Smooth animation loop with frame rate control
function animate(timestamp) {
    requestAnimationFrame(animate);
    
    // Frame rate control
    if (!timestamp) timestamp = 0;
    const elapsed = timestamp - lastTimestamp;
    if (elapsed < 1000 / FPS_TARGET) return;
    lastTimestamp = timestamp - (elapsed % (1000 / FPS_TARGET));
    
    // Update device orientation control
    if (controls) {
        controls.update();
    } else if (!hasDeviceOrientation && !hasDeviceMotion) {
        // If no device orientation data, auto-rotate cube
        cube.rotation.x += 0.01;
        cube.rotation.y += 0.01;
    }
    
    renderer.render(scene, camera);
}

// Calibrate orientation
function calibrateOrientation() {
    if (controls) {
        controls.calibrate();
        infoElement.textContent = 'Orientation calibrated';
    }
}

// Initialize application
window.addEventListener('DOMContentLoaded', () => {
    // For iOS devices add permission request button
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        infoElement.textContent = 'Tap to enable AR';
        document.body.addEventListener('click', () => {
            requestOrientationPermission();
            initAR();
        }, { once: true });
    } else {
        // Directly initialize AR (non-iOS devices)
        initAR();
    }
    
    // Window resize event
    window.addEventListener('resize', onWindowResize, false);
    
    // Start animation loop
    animate();
    
    // Prevent page scrolling and zooming to improve AR experience
    document.addEventListener('touchmove', function(e) {
        e.preventDefault();
    }, { passive: false });
    
    // Listen for reset button click
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', function() {
            if (controls) {
                // First calibrate orientation
                controls.calibrate();
                
                // Reset cube to 1 meter in front of camera
                const vector = new THREE.Vector3(0, 0, -1);
                vector.applyQuaternion(camera.quaternion);
                vector.multiplyScalar(1); // 1 meter distance
                cube.position.copy(vector);
                
                infoElement.textContent = 'Position reset and orientation calibrated';
            } else {
                // No controller, directly reset position
                cube.position.set(0, 0, -1);
            }
        });
    }
}); 