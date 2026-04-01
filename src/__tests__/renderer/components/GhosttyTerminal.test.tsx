import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { THEMES } from '../../../shared/themes';
import type { TerminalEngineHandle, TerminalEngineProps } from '../../../renderer/types';

interface MockLinkProvider {
	provideLinks: ReturnType<typeof vi.fn>;
	dispose?: ReturnType<typeof vi.fn>;
}

interface MockTerminalInstance {
	options: {
		fontFamily: string;
		fontSize: number;
		theme: Record<string, string | undefined>;
	};
	open: ReturnType<typeof vi.fn>;
	write: ReturnType<typeof vi.fn>;
	focus: ReturnType<typeof vi.fn>;
	clear: ReturnType<typeof vi.fn>;
	scrollToBottom: ReturnType<typeof vi.fn>;
	dispose: ReturnType<typeof vi.fn>;
	getSelection: ReturnType<typeof vi.fn>;
	loadAddon: ReturnType<typeof vi.fn>;
	registerLinkProvider: ReturnType<typeof vi.fn>;
	attachCustomKeyEventHandler: ReturnType<typeof vi.fn>;
	customKeyEventHandler: ((event: KeyboardEvent) => boolean) | null;
	registeredProviders: MockLinkProvider[];
	emitData: (data: string) => void;
	emitResize: (size: { cols: number; rows: number }) => void;
	emitTitleChange: (title: string) => void;
}

interface MockFitAddonInstance {
	fit: ReturnType<typeof vi.fn>;
	observeResize: ReturnType<typeof vi.fn>;
	nextDimensions: { cols: number; rows: number };
}

interface MockProviderInstance {
	provideLinks: ReturnType<typeof vi.fn>;
	dispose: ReturnType<typeof vi.fn>;
}

const ghosttyMockState = vi.hoisted(() => ({
	initMock: vi.fn(),
	terminalInstances: [] as MockTerminalInstance[],
	fitAddonInstances: [] as MockFitAddonInstance[],
	urlRegexProviderInstances: [] as MockProviderInstance[],
	osc8ProviderInstances: [] as MockProviderInstance[],
}));

const sentryMockState = vi.hoisted(() => ({
	captureExceptionMock: vi.fn(),
}));

vi.mock('ghostty-web', () => {
	class MockFitAddon {
		terminal: MockTerminal | null = null;
		nextDimensions = { cols: 100, rows: 30 };

		constructor() {
			ghosttyMockState.fitAddonInstances.push(this as unknown as MockFitAddonInstance);
		}

		activate = vi.fn((terminal: MockTerminal) => {
			this.terminal = terminal;
		});
		fit = vi.fn(() => {
			this.terminal?.emitResize(this.nextDimensions);
		});
		observeResize = vi.fn();
	}

	class MockTerminal {
		options: {
			fontFamily: string;
			fontSize: number;
			theme: Record<string, string | undefined>;
		};
		dataListeners: Array<(data: string) => void> = [];
		resizeListeners: Array<(size: { cols: number; rows: number }) => void> = [];
		titleListeners: Array<(title: string) => void> = [];
		registeredProviders: MockLinkProvider[] = [];
		customKeyEventHandler: ((event: KeyboardEvent) => boolean) | null = null;
		open = vi.fn();
		write = vi.fn();
		focus = vi.fn();
		clear = vi.fn();
		scrollToBottom = vi.fn();
		dispose = vi.fn();
		getSelection = vi.fn(() => 'selected text');
		loadAddon = vi.fn((addon: MockFitAddon) => {
			addon.activate(this);
		});
		registerLinkProvider = vi.fn((provider: MockLinkProvider) => {
			this.registeredProviders.push(provider);
		});
		attachCustomKeyEventHandler = vi.fn((handler: (event: KeyboardEvent) => boolean) => {
			this.customKeyEventHandler = handler;
		});

		constructor(options?: {
			fontFamily?: string;
			fontSize?: number;
			theme?: Record<string, string | undefined>;
		}) {
			this.options = {
				fontFamily: options?.fontFamily ?? 'monospace',
				fontSize: options?.fontSize ?? 14,
				theme: options?.theme ?? {},
			};

			ghosttyMockState.terminalInstances.push(this as unknown as MockTerminalInstance);
		}

		onData(listener: (data: string) => void) {
			this.dataListeners.push(listener);
			return {
				dispose: vi.fn(() => {
					this.dataListeners = this.dataListeners.filter((entry) => entry !== listener);
				}),
			};
		}

		onResize(listener: (size: { cols: number; rows: number }) => void) {
			this.resizeListeners.push(listener);
			return {
				dispose: vi.fn(() => {
					this.resizeListeners = this.resizeListeners.filter((entry) => entry !== listener);
				}),
			};
		}

		onTitleChange(listener: (title: string) => void) {
			this.titleListeners.push(listener);
			return {
				dispose: vi.fn(() => {
					this.titleListeners = this.titleListeners.filter((entry) => entry !== listener);
				}),
			};
		}

		emitData(data: string) {
			for (const listener of this.dataListeners) {
				listener(data);
			}
		}

		emitResize(size: { cols: number; rows: number }) {
			for (const listener of this.resizeListeners) {
				listener(size);
			}
		}

		emitTitleChange(title: string) {
			for (const listener of this.titleListeners) {
				listener(title);
			}
		}
	}

	class MockUrlRegexProvider {
		terminal: MockTerminal;
		provideLinks = vi.fn((_y: number, callback: (links: unknown[] | undefined) => void) => {
			callback(undefined);
		});
		dispose = vi.fn();
		constructor(terminal: MockTerminal) {
			this.terminal = terminal;
			ghosttyMockState.urlRegexProviderInstances.push(this as unknown as MockProviderInstance);
		}
	}

	class MockOSC8LinkProvider {
		terminal: MockTerminal;
		provideLinks = vi.fn((_y: number, callback: (links: unknown[] | undefined) => void) => {
			callback(undefined);
		});
		dispose = vi.fn();
		constructor(terminal: MockTerminal) {
			this.terminal = terminal;
			ghosttyMockState.osc8ProviderInstances.push(this as unknown as MockProviderInstance);
		}
	}

	return {
		init: ghosttyMockState.initMock,
		Terminal: MockTerminal,
		FitAddon: MockFitAddon,
		UrlRegexProvider: MockUrlRegexProvider,
		OSC8LinkProvider: MockOSC8LinkProvider,
	};
});

vi.mock('../../../renderer/utils/sentry', () => ({
	captureException: sentryMockState.captureExceptionMock,
}));

describe('GhosttyTerminal', () => {
	let GhosttyTerminal: typeof import('../../../renderer/components/GhosttyTerminal').GhosttyTerminal;
	let processDataHandler: ((sessionId: string, data: string) => void) | null;

	beforeEach(async () => {
		vi.resetModules();

		ghosttyMockState.initMock.mockReset().mockResolvedValue(undefined);
		ghosttyMockState.terminalInstances.length = 0;
		ghosttyMockState.fitAddonInstances.length = 0;
		ghosttyMockState.urlRegexProviderInstances.length = 0;
		ghosttyMockState.osc8ProviderInstances.length = 0;
		sentryMockState.captureExceptionMock.mockReset();
		processDataHandler = null;

		(window.maestro.process.write as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(true);
		(window.maestro.process.resize as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(true);
		(window.maestro.process as Record<string, unknown>).onData = vi.fn((handler) => {
			processDataHandler = handler as (sessionId: string, data: string) => void;
			return vi.fn();
		});

		({ GhosttyTerminal } = await import('../../../renderer/components/GhosttyTerminal'));
	});

	function renderComponent(
		overrides: Partial<TerminalEngineProps> = {},
		ref = React.createRef<TerminalEngineHandle>()
	) {
		const props: TerminalEngineProps = {
			sessionId: 'session-1',
			theme: THEMES.dracula,
			fontFamily: 'JetBrains Mono',
			fontSize: 14,
			...overrides,
		};

		return {
			...render(<GhosttyTerminal ref={ref} {...props} />),
			props,
			ref,
		};
	}

	it('renders and initializes ghostty once across multiple component instances', async () => {
		render(
			<>
				<GhosttyTerminal
					sessionId="session-1"
					theme={THEMES.dracula}
					fontFamily="JetBrains Mono"
					fontSize={14}
				/>
				<GhosttyTerminal
					sessionId="session-2"
					theme={THEMES.dracula}
					fontFamily="JetBrains Mono"
					fontSize={14}
				/>
			</>
		);

		await waitFor(() => {
			expect(ghosttyMockState.terminalInstances).toHaveLength(2);
		});

		expect(screen.getAllByTestId('ghostty-terminal')).toHaveLength(2);
		expect(ghosttyMockState.initMock).toHaveBeenCalledTimes(1);
	});

	it('writes process output into the terminal and exposes imperative handle methods', async () => {
		const { ref } = renderComponent();

		await waitFor(() => {
			expect(ghosttyMockState.terminalInstances).toHaveLength(1);
		});

		const terminal = ghosttyMockState.terminalInstances[0];

		act(() => {
			processDataHandler?.('session-1', 'process output');
			ref.current?.write('manual output');
			ref.current?.focus();
			ref.current?.clear();
			ref.current?.scrollToBottom();
		});

		expect(terminal.write).toHaveBeenNthCalledWith(1, 'process output');
		expect(terminal.write).toHaveBeenNthCalledWith(2, 'manual output');
		expect(terminal.focus).toHaveBeenCalledTimes(1);
		expect(terminal.clear).toHaveBeenCalledTimes(1);
		expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1);
		expect(ref.current?.getSelection()).toBe('selected text');
	});

	it('sends terminal input back to the PTY and forwards title changes', async () => {
		const onData = vi.fn();
		const onTitleChange = vi.fn();

		renderComponent({ onData, onTitleChange });

		await waitFor(() => {
			expect(ghosttyMockState.terminalInstances).toHaveLength(1);
		});

		const terminal = ghosttyMockState.terminalInstances[0];

		act(() => {
			terminal.emitData('pwd\n');
			terminal.emitTitleChange('shell title');
		});

		expect(onData).toHaveBeenCalledWith('pwd\n');
		expect(window.maestro.process.write).toHaveBeenCalledWith('session-1', 'pwd\n');
		expect(onTitleChange).toHaveBeenCalledWith('shell title');
	});

	it('propagates fit-driven resize events to the parent and PTY', async () => {
		const onResize = vi.fn();

		renderComponent({ onResize });

		await waitFor(() => {
			expect(window.maestro.process.resize).toHaveBeenCalledWith('session-1', 100, 30);
		});

		expect(onResize).toHaveBeenCalledWith(100, 30);

		ghosttyMockState.fitAddonInstances[0].nextDimensions = { cols: 132, rows: 40 };

		act(() => {
			ghosttyMockState.fitAddonInstances[0].fit();
		});

		expect(window.maestro.process.resize).toHaveBeenCalledWith('session-1', 132, 40);
		expect(onResize).toHaveBeenCalledWith(132, 40);
	});

	it('shows the fallback message and reports init failures', async () => {
		const initError = new Error('WASM failed to load');
		ghosttyMockState.initMock.mockRejectedValueOnce(initError);

		renderComponent();

		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent(
				'Ghostty terminal failed to initialize. Switch to xterm.js in Settings > Display.'
			);
		});

		expect(sentryMockState.captureExceptionMock).toHaveBeenCalledWith(
			initError,
			expect.objectContaining({
				extra: expect.objectContaining({
					component: 'GhosttyTerminal',
					operation: 'initialize',
					sessionId: 'session-1',
				}),
			})
		);
	});

	it('disposes the terminal on unmount', async () => {
		const { unmount } = renderComponent();

		await waitFor(() => {
			expect(ghosttyMockState.terminalInstances).toHaveLength(1);
		});

		const terminal = ghosttyMockState.terminalInstances[0];

		unmount();

		expect(terminal.dispose).toHaveBeenCalledTimes(1);
	});

	describe('theme hot-reloading', () => {
		it('applies a dark theme update via options.theme without disposing the terminal', async () => {
			const ref = React.createRef<TerminalEngineHandle>();
			const { rerender } = render(
				<GhosttyTerminal
					ref={ref}
					sessionId="session-1"
					theme={THEMES.dracula}
					fontFamily="JetBrains Mono"
					fontSize={14}
				/>
			);

			await waitFor(() => {
				expect(ghosttyMockState.terminalInstances).toHaveLength(1);
			});

			const terminal = ghosttyMockState.terminalInstances[0];
			const initialTheme = { ...terminal.options.theme };

			// Switch to a different dark theme (Tokyo Night)
			rerender(
				<GhosttyTerminal
					ref={ref}
					sessionId="session-1"
					theme={THEMES['tokyo-night']}
					fontFamily="JetBrains Mono"
					fontSize={14}
				/>
			);

			// Theme should update in-place
			expect(terminal.options.theme).not.toEqual(initialTheme);
			expect(terminal.options.theme.background).toBe(THEMES['tokyo-night'].colors.bgMain);
			expect(terminal.options.theme.foreground).toBe(THEMES['tokyo-night'].colors.textMain);

			// Terminal must NOT be disposed and re-created
			expect(terminal.dispose).not.toHaveBeenCalled();
			expect(ghosttyMockState.terminalInstances).toHaveLength(1);
		});

		it('applies a light theme update without disposing the terminal', async () => {
			const ref = React.createRef<TerminalEngineHandle>();
			const { rerender } = render(
				<GhosttyTerminal
					ref={ref}
					sessionId="session-1"
					theme={THEMES.dracula}
					fontFamily="JetBrains Mono"
					fontSize={14}
				/>
			);

			await waitFor(() => {
				expect(ghosttyMockState.terminalInstances).toHaveLength(1);
			});

			const terminal = ghosttyMockState.terminalInstances[0];

			// Switch from dark (Dracula) to light (GitHub Light)
			rerender(
				<GhosttyTerminal
					ref={ref}
					sessionId="session-1"
					theme={THEMES['github-light']}
					fontFamily="JetBrains Mono"
					fontSize={14}
				/>
			);

			expect(terminal.options.theme.background).toBe(THEMES['github-light'].colors.bgMain);
			expect(terminal.options.theme.foreground).toBe(THEMES['github-light'].colors.textMain);
			expect(terminal.options.theme.cursor).toBe(THEMES['github-light'].colors.accent);

			// Still the same terminal instance — no dispose/re-create
			expect(terminal.dispose).not.toHaveBeenCalled();
			expect(ghosttyMockState.terminalInstances).toHaveLength(1);
		});

		it('correctly maps light-mode-specific ANSI colors', async () => {
			const ref = React.createRef<TerminalEngineHandle>();
			const { rerender } = render(
				<GhosttyTerminal
					ref={ref}
					sessionId="session-1"
					theme={THEMES.dracula}
					fontFamily="JetBrains Mono"
					fontSize={14}
				/>
			);

			await waitFor(() => {
				expect(ghosttyMockState.terminalInstances).toHaveLength(1);
			});

			const terminal = ghosttyMockState.terminalInstances[0];

			// Switch to light theme — mapThemeToGhostty uses mode-specific logic
			// for black, cyan, white, and brightCyan
			rerender(
				<GhosttyTerminal
					ref={ref}
					sessionId="session-1"
					theme={THEMES['github-light']}
					fontFamily="JetBrains Mono"
					fontSize={14}
				/>
			);

			const lightTheme = THEMES['github-light'];

			// Light mode: black maps to textDim, not bgSidebar
			expect(terminal.options.theme.black).toBe(lightTheme.colors.textDim);
			// Light mode: white maps to bgActivity, not textDim
			expect(terminal.options.theme.white).toBe(lightTheme.colors.bgActivity);
			// Light mode: cyan maps to accentText, not textDim
			expect(terminal.options.theme.cyan).toBe(lightTheme.colors.accentText);
			// Light mode: brightCyan maps to textMain, not accentText
			expect(terminal.options.theme.brightCyan).toBe(lightTheme.colors.textMain);
		});
	});

	describe('link detection', () => {
		it('registers both URL regex and OSC 8 link providers after open()', async () => {
			renderComponent();

			await waitFor(() => {
				expect(ghosttyMockState.terminalInstances).toHaveLength(1);
			});

			const terminal = ghosttyMockState.terminalInstances[0];

			expect(terminal.registerLinkProvider).toHaveBeenCalledTimes(2);
			expect(terminal.registeredProviders).toHaveLength(2);
		});

		it('passes through undefined when the inner provider detects no links', async () => {
			renderComponent();

			await waitFor(() => {
				expect(ghosttyMockState.terminalInstances).toHaveLength(1);
			});

			const terminal = ghosttyMockState.terminalInstances[0];
			const wrappedUrlProvider = terminal.registeredProviders[0];

			let callbackResult: unknown = 'not-called';
			wrappedUrlProvider.provideLinks(0, (links: unknown) => {
				callbackResult = links;
			});
			expect(callbackResult).toBeUndefined();
		});

		it('opens links via window.maestro.shell.openExternal when activated', async () => {
			const openExternalMock = window.maestro.shell.openExternal as ReturnType<typeof vi.fn>;
			openExternalMock.mockReset().mockResolvedValue(undefined);

			// Make the inner UrlRegexProvider return a link
			const fakeLink = {
				text: 'https://example.com/page',
				range: { start: { x: 0, y: 0 }, end: { x: 23, y: 0 } },
				activate: vi.fn(),
			};

			renderComponent();

			await waitFor(() => {
				expect(ghosttyMockState.urlRegexProviderInstances).toHaveLength(1);
			});

			// Override the inner mock to return our fake link
			const innerProvider = ghosttyMockState.urlRegexProviderInstances[0];
			innerProvider.provideLinks.mockImplementation(
				(_y: number, callback: (links: unknown[] | undefined) => void) => {
					callback([fakeLink]);
				}
			);

			const terminal = ghosttyMockState.terminalInstances[0];
			const wrappedUrlProvider = terminal.registeredProviders[0];

			let wrappedLinks: Array<{ text: string; activate: (event: MouseEvent) => void }> = [];
			wrappedUrlProvider.provideLinks(0, (links: unknown) => {
				wrappedLinks = links as typeof wrappedLinks;
			});

			expect(wrappedLinks).toHaveLength(1);
			expect(wrappedLinks[0].text).toBe('https://example.com/page');

			// Activate the link — should call openExternal, NOT window.open
			wrappedLinks[0].activate(new MouseEvent('click'));

			expect(openExternalMock).toHaveBeenCalledWith('https://example.com/page');
			// The original activate from the built-in provider should NOT be called
			expect(fakeLink.activate).not.toHaveBeenCalled();
		});

		it('disposes the inner provider when the wrapper is disposed', async () => {
			renderComponent();

			await waitFor(() => {
				expect(ghosttyMockState.urlRegexProviderInstances).toHaveLength(1);
			});

			const innerUrlProvider = ghosttyMockState.urlRegexProviderInstances[0];
			const innerOsc8Provider = ghosttyMockState.osc8ProviderInstances[0];

			const terminal = ghosttyMockState.terminalInstances[0];

			// Call dispose on wrapped providers
			terminal.registeredProviders[0].dispose?.();
			terminal.registeredProviders[1].dispose?.();

			expect(innerUrlProvider.dispose).toHaveBeenCalledTimes(1);
			expect(innerOsc8Provider.dispose).toHaveBeenCalledTimes(1);
		});
	});

	describe('search no-op behavior', () => {
		it('returns false for search, searchNext, and searchPrevious', async () => {
			const ref = React.createRef<TerminalEngineHandle>();
			renderComponent({}, ref);

			await waitFor(() => {
				expect(ghosttyMockState.terminalInstances).toHaveLength(1);
			});

			expect(ref.current?.search('query')).toBe(false);
			expect(ref.current?.searchNext()).toBe(false);
			expect(ref.current?.searchPrevious()).toBe(false);
		});

		it('logs a one-time console.info on the first search invocation', async () => {
			const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

			const ref = React.createRef<TerminalEngineHandle>();
			renderComponent({}, ref);

			await waitFor(() => {
				expect(ghosttyMockState.terminalInstances).toHaveLength(1);
			});

			// First call should log
			ref.current?.search('test');
			expect(infoSpy).toHaveBeenCalledTimes(1);
			expect(infoSpy).toHaveBeenCalledWith(
				'[GhosttyTerminal] Search is not yet supported by ghostty-web 0.4.0'
			);

			// Subsequent calls should not log again
			ref.current?.searchNext();
			ref.current?.searchPrevious();
			ref.current?.search('another');
			expect(infoSpy).toHaveBeenCalledTimes(1);

			infoSpy.mockRestore();
		});

		it('logs once even when searchNext is called first', async () => {
			const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

			const ref = React.createRef<TerminalEngineHandle>();
			renderComponent({}, ref);

			await waitFor(() => {
				expect(ghosttyMockState.terminalInstances).toHaveLength(1);
			});

			ref.current?.searchNext();
			expect(infoSpy).toHaveBeenCalledTimes(1);

			ref.current?.searchPrevious();
			ref.current?.search('query');
			expect(infoSpy).toHaveBeenCalledTimes(1);

			infoSpy.mockRestore();
		});
	});

	describe('keyboard shortcut passthrough', () => {
		/** Helper to create a KeyboardEvent-like object for the custom key handler. */
		function makeKeyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
			return {
				key: '',
				code: '',
				metaKey: false,
				ctrlKey: false,
				altKey: false,
				shiftKey: false,
				...overrides,
			} as unknown as KeyboardEvent;
		}

		it('registers a custom key event handler after open()', async () => {
			renderComponent();

			await waitFor(() => {
				expect(ghosttyMockState.terminalInstances).toHaveLength(1);
			});

			const terminal = ghosttyMockState.terminalInstances[0];
			expect(terminal.attachCustomKeyEventHandler).toHaveBeenCalledTimes(1);
			expect(terminal.customKeyEventHandler).toBeTypeOf('function');
		});

		describe('macOS (Cmd shortcuts)', () => {
			beforeEach(() => {
				(window as any).maestro.platform = 'darwin';
			});

			it('returns true for Cmd+T (pass through to Maestro)', async () => {
				renderComponent();

				await waitFor(() => {
					expect(ghosttyMockState.terminalInstances).toHaveLength(1);
				});

				const handler = ghosttyMockState.terminalInstances[0].customKeyEventHandler!;
				const result = handler(makeKeyEvent({ key: 't', metaKey: true }));
				expect(result).toBe(true);
			});

			it('returns true for Cmd+K (quick actions)', async () => {
				renderComponent();

				await waitFor(() => {
					expect(ghosttyMockState.terminalInstances).toHaveLength(1);
				});

				const handler = ghosttyMockState.terminalInstances[0].customKeyEventHandler!;
				expect(handler(makeKeyEvent({ key: 'k', metaKey: true }))).toBe(true);
			});

			it('returns true for Cmd+Shift+[ (cycle previous)', async () => {
				renderComponent();

				await waitFor(() => {
					expect(ghosttyMockState.terminalInstances).toHaveLength(1);
				});

				const handler = ghosttyMockState.terminalInstances[0].customKeyEventHandler!;
				expect(handler(makeKeyEvent({ key: '[', metaKey: true, shiftKey: true }))).toBe(true);
			});

			it('returns false for normal letter keys (terminal handles)', async () => {
				renderComponent();

				await waitFor(() => {
					expect(ghosttyMockState.terminalInstances).toHaveLength(1);
				});

				const handler = ghosttyMockState.terminalInstances[0].customKeyEventHandler!;
				expect(handler(makeKeyEvent({ key: 'a' }))).toBe(false);
				expect(handler(makeKeyEvent({ key: 'Enter' }))).toBe(false);
			});

			it('returns false for Ctrl+C (terminal control sequence)', async () => {
				renderComponent();

				await waitFor(() => {
					expect(ghosttyMockState.terminalInstances).toHaveLength(1);
				});

				const handler = ghosttyMockState.terminalInstances[0].customKeyEventHandler!;
				expect(handler(makeKeyEvent({ key: 'c', ctrlKey: true }))).toBe(false);
			});
		});

		describe('Option+Arrow word navigation (macOS)', () => {
			beforeEach(() => {
				(window as any).maestro.platform = 'darwin';
				(window.maestro.process.write as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(true);
			});

			it('writes ESC b for Option+Left and returns true', async () => {
				renderComponent({ sessionId: 'nav-session' });

				await waitFor(() => {
					expect(ghosttyMockState.terminalInstances).toHaveLength(1);
				});

				const handler = ghosttyMockState.terminalInstances[0].customKeyEventHandler!;
				const result = handler(makeKeyEvent({ key: 'ArrowLeft', altKey: true }));

				expect(result).toBe(true);
				expect(window.maestro.process.write).toHaveBeenCalledWith('nav-session', '\x1bb');
			});

			it('writes ESC f for Option+Right and returns true', async () => {
				renderComponent({ sessionId: 'nav-session' });

				await waitFor(() => {
					expect(ghosttyMockState.terminalInstances).toHaveLength(1);
				});

				const handler = ghosttyMockState.terminalInstances[0].customKeyEventHandler!;
				const result = handler(makeKeyEvent({ key: 'ArrowRight', altKey: true }));

				expect(result).toBe(true);
				expect(window.maestro.process.write).toHaveBeenCalledWith('nav-session', '\x1bf');
			});

			it('does not intercept Option+ArrowUp/Down (lets Ghostty handle)', async () => {
				renderComponent();

				await waitFor(() => {
					expect(ghosttyMockState.terminalInstances).toHaveLength(1);
				});

				const handler = ghosttyMockState.terminalInstances[0].customKeyEventHandler!;
				expect(handler(makeKeyEvent({ key: 'ArrowUp', altKey: true }))).toBe(false);
				expect(handler(makeKeyEvent({ key: 'ArrowDown', altKey: true }))).toBe(false);
			});
		});

		describe('non-macOS (Linux/Windows)', () => {
			beforeEach(() => {
				(window as any).maestro.platform = 'linux';
			});

			it('returns true for Meta (Super) key combos', async () => {
				renderComponent();

				await waitFor(() => {
					expect(ghosttyMockState.terminalInstances).toHaveLength(1);
				});

				const handler = ghosttyMockState.terminalInstances[0].customKeyEventHandler!;
				expect(handler(makeKeyEvent({ key: 't', metaKey: true }))).toBe(true);
			});

			it('returns true for Ctrl+Shift combos (Maestro shortcuts)', async () => {
				renderComponent();

				await waitFor(() => {
					expect(ghosttyMockState.terminalInstances).toHaveLength(1);
				});

				const handler = ghosttyMockState.terminalInstances[0].customKeyEventHandler!;
				expect(handler(makeKeyEvent({ key: '[', ctrlKey: true, shiftKey: true }))).toBe(true);
			});

			it('returns true for Ctrl+Alt combos (Maestro shortcuts)', async () => {
				renderComponent();

				await waitFor(() => {
					expect(ghosttyMockState.terminalInstances).toHaveLength(1);
				});

				const handler = ghosttyMockState.terminalInstances[0].customKeyEventHandler!;
				expect(handler(makeKeyEvent({ key: 's', ctrlKey: true, altKey: true }))).toBe(true);
			});

			it('returns false for plain Ctrl+key (terminal control)', async () => {
				renderComponent();

				await waitFor(() => {
					expect(ghosttyMockState.terminalInstances).toHaveLength(1);
				});

				const handler = ghosttyMockState.terminalInstances[0].customKeyEventHandler!;
				expect(handler(makeKeyEvent({ key: 'c', ctrlKey: true }))).toBe(false);
				expect(handler(makeKeyEvent({ key: 'd', ctrlKey: true }))).toBe(false);
			});
		});
	});
});
