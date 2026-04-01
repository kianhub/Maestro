import { forwardRef, lazy, Suspense } from 'react';

import type { TerminalEngine } from '../stores/settingsStore';
import type { TerminalEngineHandle, TerminalEngineProps } from '../types/terminalEngine';
import { useSettingsStore } from '../stores/settingsStore';
import { XTerminal } from './XTerminal';

const LazyGhosttyTerminal = lazy(() =>
	import('./GhosttyTerminal').then((m) => ({ default: m.GhosttyTerminal }))
);

export interface TerminalViewProps extends TerminalEngineProps {
	/** Per-tab engine override. When set, takes precedence over the global setting. */
	engine?: TerminalEngine;
}

/**
 * Renders the active terminal engine based on:
 *   1. An explicit per-tab `engine` prop (highest priority), or
 *   2. The global `terminalEngine` setting from the settings store.
 */
export const TerminalView = forwardRef<TerminalEngineHandle, TerminalViewProps>(
	function TerminalView({ engine, ...props }, ref) {
		const globalEngine = useSettingsStore((s) => s.terminalEngine);
		const resolvedEngine = engine ?? globalEngine;

		if (resolvedEngine === 'ghostty') {
			return (
				<Suspense fallback={null}>
					<LazyGhosttyTerminal ref={ref} {...props} />
				</Suspense>
			);
		}

		return <XTerminal ref={ref} {...props} />;
	}
);
