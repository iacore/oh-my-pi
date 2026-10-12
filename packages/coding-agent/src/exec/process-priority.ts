/**
 * Lower the scheduling priority of omp and everything it spawns.
 *
 * Why every thread: Linux keeps one nice value per *thread*, and
 * `setpriority(PRIO_PROCESS, 0, n)` moves only the calling thread — leaving
 * Bun's worker and I/O threads at the default priority, and a child forked from
 * one of them inherits that instead. Descendants inherit the niceness of the
 * thread that forked them, so setting every thread in `/proc/self/task` makes
 * the whole tree low priority from birth: the TypeScript language server
 * (`tsgo`), `cargo`'s rustc workers, and bash children all yield to interactive
 * work. Without it a single build or indexing pass pins every core and the
 * desktop stutters.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import { debug } from "@oh-my-pi/pi-utils/logger";

/**
 * Apply `nice` to the current process. No-op for a non-positive value.
 *
 * On Linux every thread is niced so spawned children inherit the value; other
 * platforms use the process-wide POSIX `setpriority`. Never throws.
 */
export function applyProcessNice(nice: number): void {
	if (!Number.isInteger(nice) || nice <= 0) return;
	try {
		if (process.platform === "linux") {
			for (const tid of fs.readdirSync("/proc/self/task")) {
				try {
					os.setPriority(Number(tid), nice);
				} catch {
					// A thread that exited between listing and setting is not fatal.
				}
			}
			return;
		}
		os.setPriority(0, nice);
	} catch (error) {
		debug("process niceness not applied", { nice, error: String(error) });
	}
}
