/**
 * Settings declared by this domain (see `config/registry.ts`). Declaration order is the
 * settings-panel order; `config/all-settings.ts` registers every domain.
 */
import { register } from "../config/registry";

// The `manage_skill` and `learn` tools, and the managed-skills directory they
// write. The trigger policy that asks the model to use them lives outside core,
// in an operator-tunable extension (`~/.omp/agent/extensions/autolearn`): how
// often a session is worth re-reading differs per operator, while the tools
// themselves do not.
export const cfgAutolearnEnabled = register({
	id: "autolearn.enabled",
	type: "boolean",
	default: false,
	ui: {
		tab: "memory",
		group: "Auto-Learn",
		label: "Managed skills + learn tools",
		description:
			"Expose `manage_skill` and `learn`, and discover skills written to the managed-skills directory. The capture policy that drives them is an extension.",
	},
});
