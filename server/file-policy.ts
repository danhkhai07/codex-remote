import { isAbsolute, resolve, sep } from 'node:path'

const systemRoots = ['/etc', '/proc', '/sys', '/dev', '/boot', '/run', '/var/lib', '/var/log', '/usr', '/bin', '/sbin', '/lib', '/lib64']
const inside = (path: string, root: string) => path === root || path.startsWith(root + sep)
const privateDirectories = new Set(['.ssh', '.gnupg', '.aws', '.azure', '.config', '.local', '.codex', '.docker', '.kube', '.state', '.orchestration', '.git'])
const privateNames = /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|auth\.json|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|authorized_keys|known_hosts|shadow|gshadow)$/i
export function deniedFilePath(input: string): boolean {
  const path = resolve(input)
  if (systemRoots.some(root => inside(path, root))) return true
  return input.split(/[\\/]/).some(part => privateDirectories.has(part.toLowerCase())
    || (privateNames.test(part) && !/^\.env\.(example|sample|template)$/i.test(part))
    || /\.(?:pem|key|p12|pfx|keystore)$/i.test(part))
}
export function validFileRoot(root: string): boolean {
  return isAbsolute(root) && !['/', '/root', '/home', '/var', '/opt'].includes(resolve(root)) && !deniedFilePath(root)
}
export function allowedFilePath(input: string, roots: string[]): boolean {
  return !input.includes('\0') && isAbsolute(input) && !deniedFilePath(input)
    && roots.some(root => validFileRoot(root) && inside(resolve(input), resolve(root)))
}
