import * as THREE from '../three.js'
import { interpolateArc } from './arc-interpolation.js'

// Reads a gcode word's numeric value (e.g. "X" -> 10 from "G1 X10"); NaN if the word is absent
const parseWord = (cmd, letter) => parseFloat(cmd.split(letter)[1])

// How far behind the live print the nozzle trails to absorb bursty updates; higher looks smoother but lags real time more, lower tracks tighter but can stutter
const NOZZLE_LAG_SECONDS = 0.75
// How gradually the nozzle changes speed; higher glides between speeds, lower reacts at once but looks jerky
const SPEED_SMOOTHING_SECONDS = 0.3
// How much the nozzle may speed up or slow down to catch up (2 = up to 2x faster or half speed); higher recovers quicker but the catch-up shows more
const SPEED_TOLERANCE = 2.0
// Window over which the print's actual speed is observed before locking onto it; wider is steadier but a wrong-speed start lasts longer, narrower locks on sooner but wobblier
const OBSERVATION_WINDOW_SECONDS = 4
// How far behind, as a multiple of the normal lag, before the nozzle gives up easing and jumps to the live position; higher tolerates longer stalls, lower resyncs sooner
const RESYNC_LAG_MULTIPLE = 7

class HeadState {
  position = new THREE.Vector3(0, 0, 0)
  speed = 5.0 * 60
  relative = false

  clone () {
    const headState = new HeadState()
    headState.position.copy(this.position)
    headState.speed = this.speed
    headState.relative = this.relative
    return headState
  }
}

export class PrintHeadSimulator {
  // Parsing
  // Head position and speed tracked while reading G-code
  parserState = new HeadState()
  // After a page reload while printing, X/Y and Z are unknown
  xyKnown = false
  zKnown = false

  // Queue
  // Moves waiting to be played back
  moveQueue = []
  // Last queued position, used to measure each move's length
  lastQueuedPosition = new THREE.Vector3(0, 0, 0)
  // How much motion time is buffered ahead
  queuedSeconds = 0

  // Playback
  // Where the nozzle is currently shown
  currentPosition = new THREE.Vector3(0, 0, 0)
  // Playback speed as a multiple of real time
  rateCorrection = 1
  // The print's own speed the nozzle settles to, so it keeps pace whether the print runs slow or fast
  liveSpeed = 1
  pendingMotion = 0
  recentMotion = 0
  recentTime = 0

  addCommand (cmd) {
    const parserState = this.parserState
    const gcode = (cmd.match(/\bG\d+/i) || [''])[0].toUpperCase()
    const isClockwise = gcode === 'G2'
    const isArcMove = isClockwise || gcode === 'G3'
    const isLinearMove = gcode === 'G0' || gcode === 'G1'

    if (isLinearMove || isArcMove) {
      const arcStart = isArcMove ? { x: parserState.position.x, y: parserState.position.y, z: parserState.position.z, e: 0, f: parserState.speed } : null

      const x = parseWord(cmd, 'X')
      const hasX = !Number.isNaN(x)
      if (hasX) parserState.position.x = parserState.relative ? parserState.position.x + x : x
      const y = parseWord(cmd, 'Y')
      const hasY = !Number.isNaN(y)
      if (hasY) parserState.position.y = parserState.relative ? parserState.position.y + y : y
      const z = parseWord(cmd, 'Z')
      if (!Number.isNaN(z)) parserState.position.z = parserState.relative ? parserState.position.z + z : z
      const f = parseWord(cmd, 'F')
      if (!Number.isNaN(f)) parserState.speed = f

      // If initial position is unknown
      if (!this.xyKnown) {
        if (hasX && hasY) {
          // The first move carrying both X and Y tells us where the head is
          this.currentPosition.copy(parserState.position)
          this.lastQueuedPosition.copy(parserState.position)
          this.xyKnown = true
        }
        return
      }

      if (isLinearMove) {
        this.enqueue(parserState.clone())
      } else {
        const arc = {
          x: parserState.position.x,
          y: parserState.position.y,
          z: parserState.position.z,
          i: parseWord(cmd, 'I') || 0,
          j: parseWord(cmd, 'J') || 0,
          r: parseWord(cmd, 'R') || 0,
          e: parseWord(cmd, 'E') || 0,
          f: parserState.speed,
          is_clockwise: isClockwise
        }
        const segments = interpolateArc(arcStart, arc)
        for (let index = 1; index < segments.length; index++) {
          const segment = parserState.clone()
          segment.position = new THREE.Vector3(segments[index].x, segments[index].y, segments[index].z)
          this.enqueue(segment)
        }
      }
    } else if (gcode === 'G90') {
      parserState.relative = false
    } else if (gcode === 'G91') {
      parserState.relative = true
    } else if (gcode === 'G92') {
      // G92 - Redefine the logical coordinates without physical motion
      const x = parseWord(cmd, 'X')
      if (!Number.isNaN(x)) parserState.position.x = this.lastQueuedPosition.x = x
      const y = parseWord(cmd, 'Y')
      if (!Number.isNaN(y)) parserState.position.y = this.lastQueuedPosition.y = y
      const z = parseWord(cmd, 'Z')
      if (!Number.isNaN(z)) parserState.position.z = this.lastQueuedPosition.z = z
    }
  }

  enqueue (segment) {
    // This move's own playing time, used to pace the nozzle and to read off the live speed
    const mmPerSecond = segment.speed / 60.0
    if (mmPerSecond > 0) {
      const seconds = segment.position.distanceTo(this.lastQueuedPosition) / mmPerSecond
      this.queuedSeconds += seconds
      this.pendingMotion += seconds
    }

    this.lastQueuedPosition.copy(segment.position)
    this.moveQueue.push(segment)

    // Hopelessly late: jump to the live position instead of crawling through a stale backlog
    if (this.queuedSeconds > RESYNC_LAG_MULTIPLE * NOZZLE_LAG_SECONDS * this.liveSpeed) this.snapToLive()
  }

  // Drop the backlog and put the nozzle where the print head actually is now
  snapToLive () {
    this.currentPosition.copy(this.lastQueuedPosition)
    this.moveQueue.length = 0
    this.queuedSeconds = 0
    this.rateCorrection = 1
  }

  // Seed absolute Z if current Z is not known
  seedZ (z) {
    if (this.zKnown || !Number.isFinite(z) || z < 0) return
    this.parserState.position.z = z
    this.currentPosition.z = z
    this.lastQueuedPosition.z = z
    this.zKnown = true
  }

  updatePosition (timeStep) {
    // Read off how fast the live print is really running, so the nozzle settles to that speed
    // and stays in sync whether the print crawls or races.
    const decay = Math.exp(-timeStep / OBSERVATION_WINDOW_SECONDS)
    this.recentMotion = this.recentMotion * decay + this.pendingMotion
    this.recentTime = this.recentTime * decay + timeStep
    this.pendingMotion = 0
    if (this.recentTime > 0) this.liveSpeed = Math.max(1, this.recentMotion / this.recentTime)

    // Clock recovery: ease the playback rate toward what keeps the buffer near its target, so the
    // nozzle follows the real feed rate while absorbing the bursty pushes instead of stop-and-go.
    const maxRate = this.liveSpeed * SPEED_TOLERANCE
    const minRate = this.liveSpeed / SPEED_TOLERANCE
    const desiredRate = Math.min(maxRate, Math.max(minRate, this.queuedSeconds / NOZZLE_LAG_SECONDS))
    const smoothing = 1 - Math.exp(-timeStep / SPEED_SMOOTHING_SECONDS)
    this.rateCorrection += (desiredRate - this.rateCorrection) * smoothing

    // Motion time available this frame to walk the nozzle along the queued moves
    const startBudget = timeStep * this.rateCorrection
    let budgetSeconds = startBudget
    while (this.moveQueue.length > 0 && budgetSeconds > 0) {
      const target = this.moveQueue[0]
      const mmPerSecond = target.speed / 60.0
      const toTarget = target.position.clone().sub(this.currentPosition)
      const remainingSeconds = mmPerSecond > 0 ? toTarget.length() / mmPerSecond : 0

      if (budgetSeconds < remainingSeconds) {
        // Budget runs out before reaching the move: advance partway and stop
        this.currentPosition.addScaledVector(toTarget, budgetSeconds / remainingSeconds)
        budgetSeconds = 0
      } else {
        // Reach the move and carry the leftover budget over to the next one
        this.currentPosition.copy(target.position)
        budgetSeconds -= remainingSeconds
        this.moveQueue.shift()
      }
    }

    // Drain the time just played back from the buffer
    this.queuedSeconds = Math.max(0, this.queuedSeconds - (startBudget - budgetSeconds))
  }

  getCurrentPosition () {
    // Unknown until the first move locates the head, e.g. while still pre-heating
    return this.xyKnown ? this.currentPosition : null
  }
}
