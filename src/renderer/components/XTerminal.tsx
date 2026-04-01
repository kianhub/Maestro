import { forwardRef, useImperativeHandle } from 'react';

import type { TerminalEngineHandle, TerminalEngineProps } from '../types/terminalEngine';

/**
 * Placeholder xterm.js terminal engine.
 *
 * This is the default terminal engine stub. A full xterm.js integration will
 * replace this component once xterm is added as a dependency. For now it
 * satisfies the `TerminalEngineHandle` / `TerminalEngineProps` contract so
 * that the engine-switching infrastructure in `TerminalView` works end-to-end.
 */
export const XTerminal = forwardRef<TerminalEngineHandle, TerminalEngineProps>(
	function XTerminal({ theme }, ref) {
		useImperativeHandle(
			ref,
			() => ({
				write: () => {},
				focus: () => {},
				clear: () => {},
				scrollToBottom: () => {},
				search: () => false,
				searchNext: () => false,
				searchPrevious: () => false,
				getSelection: () => '',
				resize: () => {},
				refresh: () => {},
			}),
			[]
		);

		return (
			<div
				data-testid="xterminal"
				style={{
					width: '100%',
					height: '100%',
					backgroundColor: theme.colors.bgMain,
					color: theme.colors.textMain,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
				}}
			>
				<span style={{ opacity: 0.5, fontSize: 13 }}>
					xterm.js terminal (pending integration)
				</span>
			</div>
		);
	}
);
