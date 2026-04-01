import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { THEMES } from '../../../shared/themes';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';

// ---------------------------------------------------------------------------
// Mock both terminal engine components so we can detect which one renders
// without pulling in ghostty-web WASM or actual xterm.js.
// ---------------------------------------------------------------------------

vi.mock('../../../renderer/components/GhosttyTerminal', () => ({
	GhosttyTerminal: React.forwardRef(function MockGhostty(
		_props: Record<string, unknown>,
		_ref: React.Ref<unknown>
	) {
		return <div data-testid="ghostty-terminal-engine" />;
	}),
}));

vi.mock('../../../renderer/components/XTerminal', () => ({
	XTerminal: React.forwardRef(function MockXTerm(
		_props: Record<string, unknown>,
		_ref: React.Ref<unknown>
	) {
		return <div data-testid="xterm-terminal-engine" />;
	}),
}));

// ---------------------------------------------------------------------------
// Import the component under test *after* mocks are in place
// ---------------------------------------------------------------------------

import { TerminalView } from '../../../renderer/components/TerminalView';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps = {
	sessionId: 'session-1',
	theme: THEMES.dracula,
	fontFamily: 'JetBrains Mono',
	fontSize: 14,
};

function setGlobalEngine(engine: 'xterm' | 'ghostty') {
	useSettingsStore.setState({ terminalEngine: engine });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TerminalView engine switching', () => {
	beforeEach(() => {
		// Reset to the default engine before each test
		setGlobalEngine('xterm');
	});

	it('renders XTerminal when the global terminalEngine setting is "xterm"', () => {
		setGlobalEngine('xterm');

		render(<TerminalView {...defaultProps} />);

		expect(screen.getByTestId('xterm-terminal-engine')).toBeInTheDocument();
		expect(screen.queryByTestId('ghostty-terminal-engine')).not.toBeInTheDocument();
	});

	it('renders GhosttyTerminal when the global terminalEngine setting is "ghostty"', async () => {
		setGlobalEngine('ghostty');

		render(<TerminalView {...defaultProps} />);

		// GhosttyTerminal is lazy-loaded via React.lazy, so await it
		await waitFor(() => {
			expect(screen.getByTestId('ghostty-terminal-engine')).toBeInTheDocument();
		});
		expect(screen.queryByTestId('xterm-terminal-engine')).not.toBeInTheDocument();
	});

	it('uses per-tab engine override regardless of the global setting', async () => {
		// Global says xterm, but the tab explicitly requests ghostty
		setGlobalEngine('xterm');

		render(<TerminalView {...defaultProps} engine="ghostty" />);

		await waitFor(() => {
			expect(screen.getByTestId('ghostty-terminal-engine')).toBeInTheDocument();
		});
		expect(screen.queryByTestId('xterm-terminal-engine')).not.toBeInTheDocument();
	});

	it('per-tab engine "xterm" overrides a global "ghostty" setting', () => {
		setGlobalEngine('ghostty');

		render(<TerminalView {...defaultProps} engine="xterm" />);

		expect(screen.getByTestId('xterm-terminal-engine')).toBeInTheDocument();
		expect(screen.queryByTestId('ghostty-terminal-engine')).not.toBeInTheDocument();
	});

	it('switches engines when the global setting changes', async () => {
		setGlobalEngine('xterm');

		const { rerender } = render(<TerminalView {...defaultProps} />);

		expect(screen.getByTestId('xterm-terminal-engine')).toBeInTheDocument();

		// Simulate user changing the setting
		setGlobalEngine('ghostty');

		// Re-render to pick up the store change
		rerender(<TerminalView {...defaultProps} />);

		await waitFor(() => {
			expect(screen.getByTestId('ghostty-terminal-engine')).toBeInTheDocument();
		});
		expect(screen.queryByTestId('xterm-terminal-engine')).not.toBeInTheDocument();
	});
});
