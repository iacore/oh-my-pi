#!/bin/sh
# Install the dev `omp` wrapper into `$OMP_BIN_DIR`, default `$HOME/.local/bin`.
#
# Replaces the bun-shebang symlink that `bun --cwd=packages/coding-agent link`
# creates (pointing at `src/cli.ts`) with the safer wrapper at
# `packages/coding-agent/scripts/omp`. See that wrapper's header comment for the
# bunfig.toml-preload bug it works around.
#
# `~/.local/bin` is where the release installer puts omp, and it normally
# precedes Bun's global bin on PATH, so the wrapper there shadows the entry
# `bun link` leaves in Bun's bin. That entry is removed rather than left
# behind: it is a plain bun shebang on `src/cli.ts` — the preload-buggy launcher
# this script exists to replace — and on a host where Bun's bin comes first on
# PATH it would be the one `omp` resolves to.
#
# Bun's global bin path is still resolved defensively because `bun pm -g bin`
# aborts (`No package.json was found for directory "$HOME/.bun/install/global"`)
# on fresh hosts where the global install has not been initialized. Falling
# through that error would expand `$(bun pm -g bin)/omp` to `/omp` and try to
# write under `/` — see https://github.com/can1357/oh-my-pi/issues/3701.
set -e

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
target=$repo_root/packages/coding-agent/scripts/omp

if [ ! -x "$target" ]; then
	echo "link-omp: target wrapper not found or not executable: $target" >&2
	exit 1
fi

bin_dir=${OMP_BIN_DIR:-$HOME/.local/bin}
mkdir -p "$bin_dir"
ln -sfn "$target" "$bin_dir/omp"
echo "link-omp: linked $bin_dir/omp -> $target"

bun_bin=$(bun pm -g bin 2>/dev/null || true)
if [ -z "$bun_bin" ]; then
	bun_bin=${BUN_INSTALL:-$HOME/.bun}/bin
fi
if [ "$bun_bin" != "$bin_dir" ] && [ -L "$bun_bin/omp" ] && [ "$(readlink "$bun_bin/omp")" != "$target" ]; then
	rm -f "$bun_bin/omp"
	echo "link-omp: removed the bun-bin entry $bun_bin/omp"
fi