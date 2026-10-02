export function isLoopback(apiBaseUrl: string): boolean {
  try {
    const hostname = new URL(apiBaseUrl).hostname.toLowerCase()
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname === "::1"
    )
  } catch {
    return false
  }
}
