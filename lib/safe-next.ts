/** Only same-site paths are allowed as a post-sign-in destination. */
export function safeNext(value: unknown, fallback = "/"): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : fallback;
}
