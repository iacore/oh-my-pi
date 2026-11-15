import { describe, expect, it } from "bun:test";
import { planBashRedirect } from "@oh-my-pi/pi-coding-agent/tools/bash-redirect";

const ALL = ["read", "grep", "glob"];

describe("planBashRedirect", () => {
	it("maps cat and a single operand onto the read tool", () => {
		expect(planBashRedirect("cat package.json", "read", ALL)).toEqual({
			tool: "read",
			args: { path: "package.json" },
			label: "read package.json",
		});
		expect(planBashRedirect('cat "my file.txt"', "read", ALL)?.args).toEqual({ path: "my file.txt" });
	});

	it("maps head and tail onto read line selectors", () => {
		expect(planBashRedirect("head -n 5 notes.txt", "read", ALL)?.args).toEqual({ path: "notes.txt:1-5" });
		expect(planBashRedirect("head notes.txt", "read", ALL)?.args).toEqual({ path: "notes.txt:1-10" });
		expect(planBashRedirect("tail -20 notes.txt", "read", ALL)?.args).toEqual({ path: "notes.txt:-20" });
	});

	it("declines flags the read tool cannot reproduce", () => {
		expect(planBashRedirect("cat -n notes.txt", "read", ALL)).toBeUndefined();
		expect(planBashRedirect("cat notes.txt other.txt", "read", ALL)).toBeUndefined();
		expect(planBashRedirect("head --bytes=4 notes.txt", "read", ALL)).toBeUndefined();
	});

	it("maps grep flags that the grep tool already performs", () => {
		expect(planBashRedirect("grep -rn TODO src", "grep", ALL)).toEqual({
			tool: "grep",
			args: { pattern: "TODO", path: "src" },
			label: "grep TODO src",
		});
		expect(planBashRedirect("grep -i secret", "grep", ALL)?.args).toEqual({ pattern: "secret", case: false });
	});

	it("declines grep flags and operand shapes with no equivalent", () => {
		expect(planBashRedirect("grep -l TODO src", "grep", ALL)).toBeUndefined();
		expect(planBashRedirect("grep -E a src other", "grep", ALL)).toBeUndefined();
		expect(planBashRedirect("grep --include=*.ts TODO", "grep", ALL)).toBeUndefined();
	});

	it("maps find -name onto the glob tool", () => {
		expect(planBashRedirect("find . -name '*.ts'", "glob", ALL)).toEqual({
			tool: "glob",
			args: { path: "*.ts" },
			label: "glob *.ts",
		});
		expect(planBashRedirect("find src -name '*.zig'", "glob", ALL)?.args).toEqual({ path: "src/*.zig" });
	});

	it("declines the find and fd forms whose semantics differ", () => {
		expect(planBashRedirect("find . -iname '*.ts'", "glob", ALL)).toBeUndefined();
		expect(planBashRedirect("find . -type f -name '*.ts'", "glob", ALL)).toBeUndefined();
		expect(planBashRedirect("fd '*.ts'", "glob", ALL)).toBeUndefined();
		expect(planBashRedirect("locate x", "glob", ALL)).toBeUndefined();
	});

	it("declines compound syntax, expansion, and redirection", () => {
		for (const command of [
			"cat a | head",
			"cat a && echo ok",
			"cat a ; echo ok",
			"cat a &",
			"cat a > out.txt",
			"cat $FILE",
			"cat $(pwd)/a",
			"cat a\\ b",
			'cat "unterminated',
		]) {
			expect(planBashRedirect(command, "read", ALL)).toBeUndefined();
		}
	});

	it("declines operands the shell would expand first", () => {
		expect(planBashRedirect("cat *.txt", "read", ALL)).toBeUndefined();
		expect(planBashRedirect("cat ~/notes.txt", "read", ALL)).toBeUndefined();
		expect(planBashRedirect("grep TODO *.ts", "grep", ALL)).toBeUndefined();
		expect(planBashRedirect("find src/*/x -name '*.ts'", "glob", ALL)).toBeUndefined();
	});

	it("declines tools that are unavailable or not read-only", () => {
		expect(planBashRedirect("cat package.json", "read", ["bash"])).toBeUndefined();
		expect(planBashRedirect("echo hi > out.txt", "write", ALL)).toBeUndefined();
		expect(planBashRedirect("sed -i s/a/b/ f", "edit", ALL)).toBeUndefined();
		expect(planBashRedirect("cat package.json", undefined, ALL)).toBeUndefined();
	});
});
