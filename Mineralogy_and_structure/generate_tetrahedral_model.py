"""
Generate an interactive 3D tetrahedral molecule model using Three.js
This creates a standalone HTML file that can be embedded in reveal.js slides
"""

import numpy as np

def generate_tetrahedral_html():
    """
    Generate HTML file with Three.js for interactive tetrahedral silicate structure
    Silicon atom at center, 4 oxygen atoms at vertices
    """
    
    # Calculate tetrahedral coordinates
    # Regular tetrahedron with center at origin
    a = 2.0  # Edge length scaling factor
    
    # Silicon at center
    si_pos = [0, 0, 0]
    
    # Oxygen atoms at vertices of regular tetrahedron
    o_positions = [
        [a, a, a],
        [a, -a, -a],
        [-a, a, -a],
        [-a, -a, a]
    ]
    
    # Normalize to unit distances from center
    o_positions = [[x/np.sqrt(3), y/np.sqrt(3), z/np.sqrt(3)] for x, y, z in o_positions]
    
    # Scale for better visualization
    scale = 2.5
    o_positions = [[x*scale, y*scale, z*scale] for x, y, z in o_positions]
    
    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tetrahedral Silicate Structure</title>
    <style>
        body {{
            margin: 0;
            padding: 0;
            overflow: hidden;
            background-color: transparent;
            font-family: Arial, sans-serif;
        }}
        #canvas-container {{
            width: 100%;
            height: 100vh;
            position: relative;
        }}
        #info {{
            position: absolute;
            top: 10px;
            left: 10px;
            color: white;
            background: rgba(0, 0, 0, 0.5);
            padding: 10px;
            border-radius: 5px;
            font-size: 14px;
            z-index: 100;
        }}
        #controls {{
            position: absolute;
            bottom: 10px;
            left: 10px;
            color: white;
            background: rgba(0, 0, 0, 0.5);
            padding: 10px;
            border-radius: 5px;
            font-size: 12px;
            z-index: 100;
        }}
        button {{
            background: rgba(255, 255, 255, 0.2);
            border: 1px solid white;
            color: white;
            padding: 5px 10px;
            margin: 2px;
            border-radius: 3px;
            cursor: pointer;
        }}
        button:hover {{
            background: rgba(255, 255, 255, 0.4);
        }}
    </style>
</head>
<body>
    <div id="canvas-container"></div>
    <div id="info">
        <strong>SiO₄⁴⁻ Tetrahedron</strong><br>
        <span style="color: #4DA6FF;">Blue</span>: Silicon (Si)<br>
        <span style="color: #FF4444;">Red</span>: Oxygen (O)
    </div>
    <div id="controls">
        <button id="resetBtn">Reset View</button>
        <button id="toggleBondsBtn">Toggle Bonds</button>
        <button id="toggleLabelsBtn">Toggle Labels</button>
        <button id="rotateBtn">Auto Rotate</button>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script>
        // Scene setup
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);
        
        const container = document.getElementById('canvas-container');
        const camera = new THREE.PerspectiveCamera(
            75,
            container.clientWidth / container.clientHeight,
            0.1,
            1000
        );
        
        const renderer = new THREE.WebGLRenderer({{ antialias: true }});
        renderer.setSize(container.clientWidth, container.clientHeight);
        container.appendChild(renderer.domElement);
        
        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 10, 10);
        scene.add(directionalLight);
        
        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
        directionalLight2.position.set(-10, -10, -10);
        scene.add(directionalLight2);
        
        // Materials
        const siliconMaterial = new THREE.MeshPhongMaterial({{
            color: 0x4DA6FF,
            shininess: 100,
            specular: 0x111111
        }});
        
        const oxygenMaterial = new THREE.MeshPhongMaterial({{
            color: 0xFF4444,
            shininess: 80,
            specular: 0x111111
        }});
        
        const bondMaterial = new THREE.LineBasicMaterial({{
            color: 0xCCCCCC,
            linewidth: 2
        }});
        
        // Create atoms
        const atoms = [];
        const bonds = new THREE.Group();
        const labels = new THREE.Group();
        
        // Silicon atom (center)
        const siGeometry = new THREE.SphereGeometry(0.4, 32, 32);
        const siAtom = new THREE.Mesh(siGeometry, siliconMaterial);
        siAtom.position.set({si_pos[0]}, {si_pos[1]}, {si_pos[2]});
        scene.add(siAtom);
        atoms.push(siAtom);
        
        // Oxygen atoms (vertices)
        const oGeometry = new THREE.SphereGeometry(0.35, 32, 32);
        const oPositions = {o_positions};
        
        oPositions.forEach((pos, index) => {{
            const oAtom = new THREE.Mesh(oGeometry, oxygenMaterial);
            oAtom.position.set(pos[0], pos[1], pos[2]);
            scene.add(oAtom);
            atoms.push(oAtom);
            
            // Create bond (line from Si to O)
            const bondGeometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3({si_pos[0]}, {si_pos[1]}, {si_pos[2]}),
                new THREE.Vector3(pos[0], pos[1], pos[2])
            ]);
            const bond = new THREE.Line(bondGeometry, bondMaterial);
            bonds.add(bond);
        }});
        
        scene.add(bonds);
        
        // Create edges between oxygen atoms for tetrahedral shape
        const edges = [
            [0, 1], [0, 2], [0, 3],
            [1, 2], [1, 3], [2, 3]
        ];
        
        const edgeMaterial = new THREE.LineBasicMaterial({{
            color: 0x666666,
            linewidth: 1,
            transparent: true,
            opacity: 0.3
        }});
        
        edges.forEach(([i, j]) => {{
            const edgeGeometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(oPositions[i][0], oPositions[i][1], oPositions[i][2]),
                new THREE.Vector3(oPositions[j][0], oPositions[j][1], oPositions[j][2])
            ]);
            const edge = new THREE.Line(edgeGeometry, edgeMaterial);
            bonds.add(edge);
        }});
        
        // Camera position
        camera.position.z = 8;
        camera.position.y = 2;
        camera.lookAt(0, 0, 0);
        
        // Mouse controls
        let isDragging = false;
        let previousMousePosition = {{ x: 0, y: 0 }};
        let rotation = {{ x: 0, y: 0 }};
        let autoRotate = false;
        
        container.addEventListener('mousedown', (e) => {{
            isDragging = true;
            previousMousePosition = {{ x: e.clientX, y: e.clientY }};
        }});
        
        container.addEventListener('mousemove', (e) => {{
            if (isDragging) {{
                const deltaX = e.clientX - previousMousePosition.x;
                const deltaY = e.clientY - previousMousePosition.y;
                
                rotation.y += deltaX * 0.01;
                rotation.x += deltaY * 0.01;
                
                previousMousePosition = {{ x: e.clientX, y: e.clientY }};
                autoRotate = false;
            }}
        }});
        
        container.addEventListener('mouseup', () => {{
            isDragging = false;
        }});
        
        container.addEventListener('wheel', (e) => {{
            e.preventDefault();
            camera.position.z += e.deltaY * 0.01;
            camera.position.z = Math.max(3, Math.min(15, camera.position.z));
        }});
        
        // Touch controls for mobile
        let touchStartX = 0;
        let touchStartY = 0;
        
        container.addEventListener('touchstart', (e) => {{
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }});
        
        container.addEventListener('touchmove', (e) => {{
            e.preventDefault();
            const deltaX = e.touches[0].clientX - touchStartX;
            const deltaY = e.touches[0].clientY - touchStartY;
            
            rotation.y += deltaX * 0.01;
            rotation.x += deltaY * 0.01;
            
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            autoRotate = false;
        }});
        
        // Button controls
        document.getElementById('resetBtn').addEventListener('click', () => {{
            rotation = {{ x: 0, y: 0 }};
            camera.position.z = 8;
            camera.position.y = 2;
            autoRotate = false;
        }});
        
        document.getElementById('toggleBondsBtn').addEventListener('click', () => {{
            bonds.visible = !bonds.visible;
        }});
        
        document.getElementById('toggleLabelsBtn').addEventListener('click', () => {{
            const info = document.getElementById('info');
            info.style.display = info.style.display === 'none' ? 'block' : 'none';
        }});
        
        document.getElementById('rotateBtn').addEventListener('click', () => {{
            autoRotate = !autoRotate;
            document.getElementById('rotateBtn').textContent = 
                autoRotate ? 'Stop Rotation' : 'Auto Rotate';
        }});
        
        // Window resize handler
        window.addEventListener('resize', () => {{
            camera.aspect = container.clientWidth / container.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(container.clientWidth, container.clientHeight);
        }});
        
        // Animation loop
        function animate() {{
            requestAnimationFrame(animate);
            
            if (autoRotate) {{
                rotation.y += 0.005;
            }}
            
            // Apply rotation to all atoms and bonds
            atoms.forEach(atom => {{
                const pos = atom.position.clone();
                
                // Rotate around Y axis
                const cosY = Math.cos(rotation.y);
                const sinY = Math.sin(rotation.y);
                const newX = pos.x * cosY - pos.z * sinY;
                const newZ = pos.x * sinY + pos.z * cosY;
                
                // Rotate around X axis
                const cosX = Math.cos(rotation.x);
                const sinX = Math.sin(rotation.x);
                const newY = pos.y * cosX - newZ * sinX;
                const finalZ = pos.y * sinX + newZ * cosX;
                
                // Store original position if not already stored
                if (!atom.userData.originalPos) {{
                    atom.userData.originalPos = pos.clone();
                }}
                
                // Apply rotation to original position
                const orig = atom.userData.originalPos;
                const rotatedX = orig.x * cosY - orig.z * sinY;
                const rotatedZ = orig.x * sinY + orig.z * cosY;
                const rotatedY = orig.y * cosX - rotatedZ * sinX;
                const rotatedZFinal = orig.y * sinX + rotatedZ * cosX;
                
                atom.position.set(rotatedX, rotatedY, rotatedZFinal);
            }});
            
            // Update bonds
            scene.remove(bonds);
            bonds.clear();
            
            // Si-O bonds
            oPositions.forEach((_, index) => {{
                const bondGeometry = new THREE.BufferGeometry().setFromPoints([
                    atoms[0].position.clone(),
                    atoms[index + 1].position.clone()
                ]);
                const bond = new THREE.Line(bondGeometry, bondMaterial);
                bonds.add(bond);
            }});
            
            // O-O edges
            edges.forEach(([i, j]) => {{
                const edgeGeometry = new THREE.BufferGeometry().setFromPoints([
                    atoms[i + 1].position.clone(),
                    atoms[j + 1].position.clone()
                ]);
                const edge = new THREE.Line(edgeGeometry, edgeMaterial);
                bonds.add(edge);
            }});
            
            scene.add(bonds);
            
            renderer.render(scene, camera);
        }}
        
        animate();
    </script>
</body>
</html>"""
    
    return html_content

if __name__ == "__main__":
    html = generate_tetrahedral_html()
    
    output_path = "molecules/tetrahedral_model.html"
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)
    
    print(f"✓ Generated {output_path}")
    print("✓ Interactive 3D tetrahedral model created successfully!")
    print("✓ Features: Drag to rotate, scroll to zoom, interactive buttons")
    print("✓ Ready to embed in reveal.js slides")
