/** Tool names of the shell tool's dialects: the embedded bash engine, and fish where the host has fish. */
export function isShellToolName(name: string | undefined): boolean {
	return name === "bash" || name === "fish";
}
