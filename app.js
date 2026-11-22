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
    color: 0x3b82f6,
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

// --- 4. Kalkulator Analisis (BEMT Proxy) ---
function updatePerformanceAnalysis(blades, span, rootChord, taper, twistDeg, rpm, vel) {
    const n = rpm / 60; // Pusingan sesaat (RPS)
    
    // Kiraan Luas Rentas (Estimate)
    const spanM = span / 1000;
    const chordM = rootChord / 1000;
    const D = spanM * 2; // Diameter keseluruhan
    
    if (n === 0) {
        document.getElementById('outThrust').innerText = "0.00 N";
        document.getElementById('outTorque').innerText = "0.00 Nm";
        document.getElementById('outPower').innerText = "0.00 W";
        document.getElementById('outEff').innerText = "0.0 %";
        return;
    }
    
    const rho = 1.225; // Ketumpatan udara (kg/m^3)
    const pitchRad = twistDeg * (Math.PI / 180);
    const tipSpeed = n * Math.PI * D;
    const idealPitchVelocity = n * pitchRad * (D / 2) * 5; // Parameter empirikal makmal
    
    let thrust = 0, torque = 0, power = 0, eff = 0;
    
    // Keadaan Udara Bergerak (Stall Dynamics)
    if (vel > idealPitchVelocity) {
        thrust = -0.5 * rho * vel * vel * (D * D) * 0.05; // Seretan pemegun (Windmilling)
    } else {
        // Pekali proksi Tujahan (CT) dan Daya Kilas (CQ)
        let CT = 0.08 * blades * (chordM / D) * (twistDeg / 10) * (1 - (vel / idealPitchVelocity));
        if (CT < 0) CT = 0;
        
        let CQ = (CT * 0.15) + (0.005 * blades * (chordM / D)); 
        
        thrust = CT * rho * Math.pow(n, 2) * Math.pow(D, 4);
        torque = CQ * rho * Math.pow(n, 2) * Math.pow(D, 5);
        power = torque * 2 * Math.PI * n; // P = τ * ω
        
        if (vel === 0) {
            eff = 0; // Kecekapan propulsi statik (hover) adalah sifar berdasarkan formula
        } else {
            eff = (thrust * vel) / power; 
        }
    }
    
    document.getElementById('outThrust').innerText = thrust > 0 ? thrust.toFixed(2) + " N" : "Pegun/Brek";
    document.getElementById('outTorque').innerText = torque.toFixed(2) + " Nm";
    document.getElementById('outPower').innerText = power > 1000 ? (power/1000).toFixed(2) + " kW" : power.toFixed(2) + " W";
    document.getElementById('outEff').innerText = eff > 0 ? (eff * 100).toFixed(1) + " %" : "0.0 %";
}

// --- 5. Logik Pemodelan Kipas 3D ---
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
    const rpm = parseFloat(document.getElementById('inpRPM').value);
    const vel = parseFloat(document.getElementById('inpVel').value);
    
    // Pilih profil: Fail Luaran vs Standard NACA
    let shapeToExtrude;
    if (customAirfoilPoints && customAirfoilPoints.length > 0) {
        shapeToExtrude = generateCustomShape(rootChord, customAirfoilPoints);
    } else {
        const nacaCode = document.getElementById('inpNACA').value;
        shapeToExtrude = generateNACAShape(rootChord, nacaCode);
    }
    
    const extrudeSettings = { depth: span, bevelEnabled: false, steps: 60 };
    const geometry = new THREE.ExtrudeGeometry(shapeToExtrude, extrudeSettings);
    
    const positionAttribute = geometry.attributes.position;
    const vertex = new THREE.Vector3();
    const pitchAxisX = rootChord * 0.25; // 25% Aerodynamic Center
    
    for (let i = 0; i < positionAttribute.count; i++) {
        vertex.fromBufferAttribute(positionAttribute, i);
        
        const zFactor = vertex.z / span; // 0 di pangkal, 1 di hujung
        
        let x = vertex.x - pitchAxisX;
        let y = vertex.y;
        
        // A. Pengecilan Hujung (Taper)
        const taperAmount = 1.0 - (zFactor * (1.0 - taperTarget));
        x *= taperAmount;
        y *= taperAmount;
        
        // B. Piuhan Kisaran (Twist)
        const currentTwist = zFactor * twist;
        const newX = x * Math.cos(-currentTwist) - y * Math.sin(-currentTwist); // Negatif untuk realiti pitch
        const newY = x * Math.sin(-currentTwist) + y * Math.cos(-currentTwist);
        
        // C. Sudut Sapuan (Sweep)
        const sweepOffset = Math.tan(sweep) * vertex.z;
        
        vertex.x = newX + (pitchAxisX * taperAmount) - sweepOffset;
        vertex.y = newY;
        positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    
    geometry.computeVertexNormals();
    
    // Anjak paksi untuk dicantumkan ke dinding luaran hab silinder
    geometry.translate(-pitchAxisX, 0, hubRadius);
    
    // BINA TATASUSUNAN JEJARI (Radial Array Group)
    const angleStep = (Math.PI * 2) / blades;
    
    for(let i=0; i < blades; i++) {
        const bladeMesh = new THREE.Mesh(geometry, material);
        // Putarkan supaya span menghala keluar (mendatar XZ) bukannya menegak
        bladeMesh.rotation.x = Math.PI / 2;
        // Posisikan mengelilingi aci Y (Y-Axis Shaft)
        bladeMesh.rotation.y = angleStep * i;
        
        propellerGroup.add(bladeMesh);
    }
    
    // Bina Struktur Hab Tengah (Aci)
    const hubGeometry = new THREE.CylinderGeometry(hubRadius, hubRadius, rootChord * 1.5, 32);
    const hubMesh = new THREE.Mesh(hubGeometry, material);
    propellerGroup.add(hubMesh);
    
    // Orientasi terakhir untuk memaparkan putaran secara mendatar di grid
    propellerGroup.rotation.z = Math.PI / 2;
    propellerGroup.position.y = span; // Angkat model dari atas lantai grid
    
    scene.add(propellerGroup);
    
    // Kemas Kini Analisis Angka
    updatePerformanceAnalysis(blades, span, rootChord, taper, twist * (180/Math.PI), rpm, vel);
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
    link.download = 'Kipas_Aero_Makmal.stl';
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
});

document.getElementById('btnReset').addEventListener('click', () => {
    const defaults = {
        'Blades': 2, 'Hub': 15, 'Span': 150, 'Root': 40, 
        'Taper': 0.5, 'Twist': 15, 'Sweep': 0, 'RPM': 3000, 'Vel': 0
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
    
    // Putarkan kipas secara maya berdasarkan gelangsar RPM
    const rpm = parseFloat(document.getElementById('inpRPM').value);
    if(propellerGroup && rpm > 0) {
        // Skala visual agar putaran tidak kelihatan patah balik (strobe effect)
        propellerGroup.rotation.x -= (rpm / 1000) * 0.1;
    }
    
    controls.update();
    renderer.render(scene, camera);
}
animate();
