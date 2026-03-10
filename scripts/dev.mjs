import { spawn } from 'node:child_process'

const commands = [
  { label: 'server', command: 'npm', args: ['run', 'dev:server'] },
  { label: 'client', command: 'npm', args: ['run', 'dev:client'] },
]

const children = commands.map(({ label, command, args }) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`${label} exited with code ${code}`)
      process.exit(code)
    }
  })

  return child
})

function shutdown(signal) {
  for (const child of children) {
    child.kill(signal)
  }
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
