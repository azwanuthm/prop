import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

// --- 1. Persediaan Pemandangan ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f2f5);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(300, 200, 400);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
dirLight.position.set(100, 200, 100);
scene.add(dirLight);

const gridHelper = new THREE.GridHelper(600, 60, 0x888888, 0xdddddd);
scene.add(gridHelper);

let customAirfoilPoints = null;
let propellerGroup = null;

const material = new THREE.MeshStandardMaterial({
    color: 0x2563eb, // Biru pekat industri
    roughness: 0.3,
    metalness: 0.2,
    side: THREE.DoubleSide
});

// --- 2. Pembaca Data Selig (.dat) ---
function parseDatFile(content) {
    const lines = content.split('\n');
    const points = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.match(/^[a-zA-Z]/)) continue;
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
            const x = parseFloat(parts[0]);
            const y = parseFloat(parts[1]);
            if (!isNaN(x) && !isNaN(y)) points.push(new THREE.Vector2(x, y));
        }
    }
    return points;
}

function generateCustomShape(chord, pointsArray) {
    const shape = new THREE.Shape();
    if (pointsArray.length === 0) return shape;
    shape.moveTo(pointsArray[0].x * chord, pointsArray[0].y * chord);
    for (let i = 1; i < pointsArray.length; i++) {
        shape.lineTo(pointsArray[i].x * chord, pointsArray[i].y * chord);
    }
    shape.lineTo(pointsArray[0].x * chord, pointsArray[0].y * chord);
    return shape;
}

// --- 3. Enjin NACA 4-Digit ---
function generateNACAShape(chord, nacaCode, numPoints = 80) {
    const shape = new THREE.Shape();
    const m = parseInt(nacaCode.charAt(0)) / 100;
    const p = parseInt(nacaCode.charAt(1)) / 10;
    const t = parseInt(nacaCode.substring(2, 4)) / 100;
    
    const upperPoints = [];
    const lowerPoints = [];
    
    for (let i = 0; i <= numPoints; i++) {
        const beta = (i / numPoints) * Math.PI;
        const x = (1 - Math.cos(beta)) / 2;
        const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * Math.pow(x, 2) + 0.2843 * Math.pow(x, 3) - 0.1015 * Math.pow(x, 4));
        
        let yc = 0, dyc_dx = 0;
        if (p > 0) {
            if (x < p) {
                yc = (m / Math.pow(p, 2)) * (2 * p * x - Math.pow(x, 2));
                dyc_dx = (2 * m / Math.pow(p, 2)) * (p - x);
            } else {
                yc = (m / Math.pow(1 - p, 2)) * ((1 - 2 * p) + 2 * p * x - Math.pow(x, 2));
                dyc_dx = (2 * m / Math.pow(1 - p, 2)) * (p - x);
            }
        }
        
        const theta = Math.atan(dyc_dx);
        upperPoints.push(new THREE.Vector2((x - yt * Math.sin(theta)) * chord, (yc + yt * Math.cos(theta)) * chord));
        lowerPoints.push(new THREE.Vector2((x + yt * Math.sin(theta)) * chord, (yc - yt * Math.cos(theta)) * chord));
    }
    
    const points = [];
    for (let i = numPoints; i >= 0; i--) points.push(upperPoints[i]);
    for (let i = 1; i <= numPoints; i++) points.push(lowerPoints[i]);
    
    shape.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) shape.lineTo(points[i].x, points[i].y);
    return shape;
}

function updatePerformanceAnalysis(blades, span, rootChord, taperTarget, twistDeg, rpm, vel) {
    const n = rpm / 60; 
    const spanM = span / 1000;
    const chordM = rootChord / 1000;
    const D = spanM * 2; 
    
    if (n === 0) {
        document.getElementById('outThrust').innerText = "0.00 N";
        document.getElementById('outTorque').innerText = "0.00 Nm";
        document.getElementById('outPower').innerText = "0.00 W";
        document.getElementById('outEff').innerText = "0.0 %";
        return;
    }
    
    const rho = 1.225; 
    const pitchRad = twistDeg * (Math.PI / 180);
    const idealPitchVelocity = n * pitchRad * (D / 2) * 5; 
    
    let thrust = 0, torque = 0, power = 0, eff = 0;
    
    if (vel > idealPitchVelocity) {
        thrust = -0.5 * rho * vel * vel * (D * D) * 0.05; 
    } else {
        let CT = 0.08 * blades * (chordM / D) * (twistDeg / 10) * (1 - (vel / idealPitchVelocity));
        if (CT < 0) CT = 0;
        
        let CQ = (CT * 0.15) + (0.005 * blades * (chordM / D)); 
        
        thrust = CT * rho * Math.pow(n, 2) * Math.pow(D, 4);
        torque = CQ * rho * Math.pow(n, 2) * Math.pow(D, 5);
        power = torque * 2 * Math.PI * n; 
        
        if (vel === 0) {
            eff = 0; 
        } else {
            eff = (thrust * vel) / power; 
        }
    }
    
    document.getElementById('outThrust').innerText = thrust > 0 ? thrust.toFixed(2) + " N" : "Pegun/Brek";
    document.getElementById('outTorque').innerText = torque.toFixed(2) + " Nm";
    document.getElementById('outPower').innerText = power > 1000 ? (power/1000).toFixed(2) + " kW" : power.toFixed(2) + " W";
    document.getElementById('outEff').innerText = eff > 0 ? (eff * 100).toFixed(1) + " %" : "0.0 %";
}

// --- 5. Logik Pemodelan Kipas 3D (PRO UPGRADE) ---
function updatePropellerGeometry() {
    if (propellerGroup) scene.remove(propellerGroup);
    
    propellerGroup = new THREE.Group();
    
    const blades = parseInt(document.getElementById('inpBlades').value);
    const hubRadius = parseFloat(document.getElementById('inpHub').value);
    const span = parseFloat(document.getElementById('inpSpan').value);
    const rootChord = parseFloat(document.getElementById('inpRoot').value);
    const taperTarget = parseFloat(document.getElementById('inpTaper').value);
    const twist = parseFloat(document.getElementById('inpTwist').value) * (Math.PI / 180);
    const sweep = parseFloat(document.getElementById('inpSweep').value) * (Math.PI / 180);
    const rpm = parseFloat(document.getElementById('inpRPM').value) || 0;
    const vel = parseFloat(document.getElementById('inpVel').value) || 0;
    
    let shapeToExtrude;
    if (customAirfoilPoints && customAirfoilPoints.length > 0) {
        shapeToExtrude = generateCustomShape(rootChord, customAirfoilPoints);
    } else {
        const nacaCode = document.getElementById('inpNACA').value;
        shapeToExtrude = generateNACAShape(rootChord, nacaCode);
    }
    
    // Tingkatkan steps untuk kelicinan lengkungan (smooth curve)
    const extrudeSettings = { depth: span, bevelEnabled: false, steps: 100 };
    const geometry = new THREE.ExtrudeGeometry(shapeToExtrude, extrudeSettings);
    
    const positionAttribute = geometry.attributes.position;
    const vertex = new THREE.Vector3();
    const pitchAxisX = rootChord * 0.25; 
    
    for (let i = 0; i < positionAttribute.count; i++) {
        vertex.fromBufferAttribute(positionAttribute, i);
        
        const zFactor = vertex.z / span; 
        
        let x = vertex.x - pitchAxisX;
        let y = vertex.y;
        
        // 2. Profil Perentas Industri (Non-linear Taper / Swelling at root)
        let chordMultiplier;
        if (zFactor < 0.2) {
            // Mengembang dari 40% saiz di hub ke 100% pada 20% panjang bilah
            chordMultiplier = 0.4 + (0.6 * (zFactor / 0.2)); 
        } else {
            // Menirus perlahan-lahan ke hujung
            chordMultiplier = 1.0 - ((1.0 - taperTarget) * ((zFactor - 0.2) / 0.8));
        }
        x *= chordMultiplier;
        
        // Penebalan struktur akar (simulasi leher silinder)
        let thicknessMultiplier = 1.0;
        if (zFactor < 0.15) {
            thicknessMultiplier = 1.0 + (1.8 * (1.0 - zFactor/0.15)); // Lebarkan paksi Y di pangkal
        }
        y *= (chordMultiplier * thicknessMultiplier);
        
        // 3. Kisaran Aerodinamik Realistik (Washout)
        // Pangkal bilah mempunyai pitch curam, hujung bilah dikurangkan pitch sebanyak 70%
        const currentPitch = twist - (zFactor * twist * 0.7); 
        const newX = x * Math.cos(-currentPitch) - y * Math.sin(-currentPitch);
        const newY = x * Math.sin(-currentPitch) + y * Math.cos(-currentPitch);
        
        // 4. Sudut Sapuan (Sweep)
        const sweepOffset = Math.tan(sweep) * vertex.z;
        
        vertex.x = newX - sweepOffset; 
        vertex.y = newY;
        positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    
    geometry.computeVertexNormals();
    
    // 5. Orientasi Semula untuk Kipas
    geometry.rotateX(-Math.PI / 2); 
    geometry.translate(0, hubRadius * 0.9, 0); // Masukkan sikit ke dalam daging hab
    
    // 6. Bina Tatasusunan Jejari (Radial Array)
    const angleStep = (Math.PI * 2) / blades;
    for(let i = 0; i < blades; i++) {
        const bladeMesh = new THREE.Mesh(geometry, material);
        bladeMesh.rotation.z = angleStep * i; 
        propellerGroup.add(bladeMesh);
    }
    
    // 7. HAB AERODINAMIK INDUSTRI (Spinner + Nacelle)
    // A. Kon Hidung (Spinner) menggunakan separuh sfera yang dipanjangkan
    const spinnerGeo = new THREE.SphereGeometry(hubRadius * 1.25, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    const spinnerMesh = new THREE.Mesh(spinnerGeo, material);
    spinnerMesh.rotation.x = Math.PI / 2; // Halakan ke depan
    spinnerMesh.scale.set(1, 1, 1.8); // Lonjongkan ke depan membentuk kon
    propellerGroup.add(spinnerMesh);
    
    // B. Badan Belakang Hab (Nacelle / Cylinder)
    const cylinderGeo = new THREE.CylinderGeometry(hubRadius * 1.25, hubRadius * 1.25, rootChord * 1.2, 32);
    const cylinderMesh = new THREE.Mesh(cylinderGeo, material);
    cylinderMesh.rotation.x = Math.PI / 2;
    cylinderMesh.position.z = -rootChord * 0.6; // Tarik ke belakang bilah
    propellerGroup.add(cylinderMesh);
    
    // 8. Tetapan Kedudukan Kumpulan
    propellerGroup.rotation.set(0, 0, 0); 
    propellerGroup.position.set(0, span, 0); 
    
    scene.add(propellerGroup);
    
    // Jalankan pengiraan analisis
    updatePerformanceAnalysis(blades, span, rootChord, taperTarget, twist * (180/Math.PI), rpm, vel);
}

// --- 6. Logik Acara (Event Listeners) ---
const inputs = ['Blades', 'Hub', 'Span', 'Root', 'Taper', 'Twist', 'Sweep', 'RPM', 'Vel'];

inputs.forEach(id => {
    const slider = document.getElementById(`inp${id}`);
    const label = document.getElementById(`val${id}`);
    slider.addEventListener('input', (e) => {
        label.textContent = e.target.value;
        updatePropellerGeometry();
    });
});

document.getElementById('inpNACA').addEventListener('change', () => {
    customAirfoilPoints = null;
    document.getElementById('inpFile').value = '';
    updatePropellerGeometry();
});

document.getElementById('inpFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
        customAirfoilPoints = parseDatFile(event.target.result);
        updatePropellerGeometry();
    };
    reader.readAsText(file);
});

// Logik Muat Turun STL SolidWorks
document.getElementById('btnExportSTL').addEventListener('click', () => {
    if (!propellerGroup) return;
    const exporter = new STLExporter();
    const stlString = exporter.parse(scene);
    const blob = new Blob([stlString], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = url;
    link.download = 'Kipas_Industri_Pro.stl';
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
});

document.getElementById('btnReset').addEventListener('click', () => {
    const defaults = {
        'Blades': 3, 'Hub': 20, 'Span': 200, 'Root': 40, 
        'Taper': 0.3, 'Twist': 20, 'Sweep': 0, 'RPM': 1500, 'Vel': 5
    };
    for(let id in defaults) {
        document.getElementById(`inp${id}`).value = defaults[id];
        document.getElementById(`val${id}`).textContent = defaults[id];
    }
    document.getElementById('inpNACA').value = "4412";
    customAirfoilPoints = null;
    document.getElementById('inpFile').value = '';
    updatePropellerGeometry();
});

// Penyesuaian Saiz Pelayar
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- 7. Gelung Enjin Putaran & Animasi ---
updatePropellerGeometry();

function animate() {
    requestAnimationFrame(animate);
    
    const rpm = parseFloat(document.getElementById('inpRPM').value) || 0;
    if(propellerGroup && rpm > 0) {
        // Putarkan keseluruhan kumpulan kipas hanya pada paksi Z (Tujahan)
        propellerGroup.rotation.z -= (rpm / 1000) * 0.1;
    }
    
    controls.update();
    renderer.render(scene, camera);
}
animate();