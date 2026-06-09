'use client'

import { useRef, useEffect } from 'react'
import * as THREE from 'three'

export default function Hero3D() {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const w = mount.clientWidth
    const h = mount.clientHeight

    // ── Renderer ─────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(w, h)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)

    // ── Scene / Camera ────────────────────────────────────────
    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x0a0e1a, 0.022)

    const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 200)
    camera.position.set(14, 12, 14)
    camera.lookAt(0, 5, 0)

    // ── Lights ────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0x1a2a55, 1.2))

    const dirLight = new THREE.DirectionalLight(0xfff3cc, 1.4)
    dirLight.position.set(10, 22, 10)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.set(1024, 1024)
    dirLight.shadow.camera.left   = -22
    dirLight.shadow.camera.right  =  22
    dirLight.shadow.camera.top    =  22
    dirLight.shadow.camera.bottom = -22
    dirLight.shadow.camera.far    = 60
    scene.add(dirLight)

    const goldLight = new THREE.PointLight(0xc8a951, 3.5, 32)
    goldLight.position.set(0, 20, 0)
    scene.add(goldLight)

    const blueLight = new THREE.PointLight(0x3a5fa5, 1.8, 45)
    blueLight.position.set(-14, 8, -14)
    scene.add(blueLight)

    // ── Window texture ────────────────────────────────────────
    const textures: THREE.CanvasTexture[] = []

    function makeWindowTex(cols: number, rows: number) {
      const tw = cols * 20
      const th = rows * 20
      const canvas = document.createElement('canvas')
      canvas.width = tw
      canvas.height = th
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#0c1830'
      ctx.fillRect(0, 0, tw, th)
      const cw = tw / cols
      const ch = th / rows
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() > 0.28) {
            const rnd = Math.random()
            if      (rnd > 0.68) ctx.fillStyle = '#14caf4'
            else if (rnd > 0.40) ctx.fillStyle = '#cce0ff'
            else                 ctx.fillStyle = '#7aaee8'
            ctx.fillRect(c * cw + 2, r * ch + 2, cw - 4, ch - 4)
          }
        }
      }
      const tex = new THREE.CanvasTexture(canvas)
      textures.push(tex)
      return tex
    }

    // ── Building factory ──────────────────────────────────────
    const allMats: THREE.Material[] = []

    function mat(color: number, opts?: Partial<THREE.MeshPhongMaterialParameters>) {
      const m = new THREE.MeshPhongMaterial({ color, shininess: 50, ...opts })
      allMats.push(m)
      return m
    }

    function makeBuilding(
      bw: number, bh: number, bd: number,
      x: number, z: number,
      winCols = 4, winRows = 10,
      tint = 0xffffff,
    ) {
      const group = new THREE.Group()

      const sideA = makeWindowTex(winCols, winRows)
      const sideB = makeWindowTex(winCols, winRows)
      const sideC = makeWindowTex(winCols, winRows)
      const sideD = makeWindowTex(winCols, winRows)

      const glassMat = (tex: THREE.CanvasTexture) => {
        const m = new THREE.MeshPhongMaterial({
          map: tex,
          color: tint,
          shininess: 70,
          specular: new THREE.Color(0x224488),
        })
        allMats.push(m)
        return m
      }

      const roofM = mat(0x0c1830)

      const body = new THREE.Mesh(
        new THREE.BoxGeometry(bw, bh, bd),
        [glassMat(sideA), glassMat(sideB), roofM, roofM, glassMat(sideC), glassMat(sideD)],
      )
      body.position.y = bh / 2
      body.castShadow = true
      body.receiveShadow = true
      group.add(body)

      // Parapet
      const parapet = new THREE.Mesh(
        new THREE.BoxGeometry(bw + 0.12, 0.18, bd + 0.12),
        mat(0x182440),
      )
      parapet.position.y = bh + 0.09
      group.add(parapet)

      group.position.set(x, 0, z)
      return group
    }

    // ── Ground ────────────────────────────────────────────────
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 44),
      mat(0x08101e, { shininess: 30, specular: new THREE.Color(0x111133) }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    const grid = new THREE.GridHelper(44, 44, 0x182240, 0x0c1520)
    scene.add(grid)

    // ── City ──────────────────────────────────────────────────
    const city = new THREE.Group()

    // Hero tower — gold-tinted glass
    city.add(makeBuilding(2.4, 15, 2.4, 0, 0, 5, 15, 0xfff6d8))

    // Spire
    const spire = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 3, 6),
      mat(0xc8a951, { shininess: 90, specular: new THREE.Color(0xffcc44) }),
    )
    spire.position.set(0, 16.6, 0)
    city.add(spire)

    // Antenna rod
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 1.8, 4),
      mat(0xaaaaaa),
    )
    antenna.position.set(0, 18.3, 0)
    city.add(antenna)

    // Mid-rise towers
    city.add(makeBuilding(2,   10,  2,   5.2,  0.5,  4, 10))
    city.add(makeBuilding(2,    8,  2,  -5.2, -0.5,  4,  8))
    city.add(makeBuilding(1.9,  9, 1.9,  0.5,  5.2,  4,  9))
    city.add(makeBuilding(1.9,  7, 1.9, -0.5, -5.2,  4,  7))

    // Low-rise background
    city.add(makeBuilding(1.5, 5.5, 1.5,  4.2,  4.2, 3, 6, 0xe4eeff))
    city.add(makeBuilding(1.4, 4.5, 1.4, -4.2,  4.2, 3, 5, 0xe4eeff))
    city.add(makeBuilding(1.4, 4.0, 1.4, -4.2, -4.2, 3, 4, 0xe4eeff))
    city.add(makeBuilding(1.4, 5.0, 1.4,  4.2, -4.2, 3, 5, 0xe4eeff))
    city.add(makeBuilding(1.1, 3.0, 1.1,  7.2,  1.2, 2, 3, 0xd8e8ff))
    city.add(makeBuilding(1.1, 2.5, 1.1, -7.2, -1.2, 2, 3, 0xd8e8ff))
    city.add(makeBuilding(1.0, 3.5, 1.0,  1.5,  7.5, 2, 4, 0xd8e8ff))
    city.add(makeBuilding(1.0, 2.8, 1.0, -1.5, -7.5, 2, 3, 0xd8e8ff))

    scene.add(city)

    // ── Particles ─────────────────────────────────────────────
    const COUNT = 200
    const pos = new Float32Array(COUNT * 3)
    const vel = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 28
      pos[i * 3 + 1] = Math.random() * 20
      pos[i * 3 + 2] = (Math.random() - 0.5) * 28
      vel[i] = 0.005 + Math.random() * 0.012
    }
    const pGeo = new THREE.BufferGeometry()
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const pMat = new THREE.PointsMaterial({ size: 0.07, color: 0xc8a951, transparent: true, opacity: 0.55 })
    const particles = new THREE.Points(pGeo, pMat)
    scene.add(particles)

    // ── Resize ────────────────────────────────────────────────
    const onResize = () => {
      const nw = mount.clientWidth
      const nh = mount.clientHeight
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
      renderer.setSize(nw, nh)
    }
    window.addEventListener('resize', onResize)

    // ── Animate ───────────────────────────────────────────────
    let animId: number
    let t = 0

    const animate = () => {
      animId = requestAnimationFrame(animate)
      t += 0.01

      city.rotation.y = t * 0.055

      const arr = pGeo.attributes.position.array as Float32Array
      for (let i = 0; i < COUNT; i++) {
        arr[i * 3 + 1] += vel[i]
        if (arr[i * 3 + 1] > 20) arr[i * 3 + 1] = 0
      }
      pGeo.attributes.position.needsUpdate = true

      goldLight.intensity = 2.8 + Math.sin(t * 1.1) * 0.9

      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
      allMats.forEach(m => m.dispose())
      textures.forEach(t => t.dispose())
      pGeo.dispose()
      pMat.dispose()
      renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={mountRef} className="h-full w-full" />
}
