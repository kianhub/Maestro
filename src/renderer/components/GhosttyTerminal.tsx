import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from 'react';
// ghostty-web v0.4.0 embeds the full ghostty-vt.wasm (423 KB) as a base64 data
// URL inside its JavaScript bundle. No separate .wasm file is emitted during
// build, and no Vite WASM plugin (e.g. vite-plugin-wasm) is required. When this
// module is lazy-loaded via React.lazy, Vite code-splits it into its own chunk
// that carries the inlined WASM. Verified with `npm run build` and `npm run dev`
// on 2026-04-01 against ghostty-web 0.4.0.
import {
	FitAddon,
	OSC8LinkProvider,
	Terminal,
	UrlRegexProvider,
	init,
	type ILink,
	type ILinkProvider,
	type ITheme as GhosttyTheme,
} from 'ghostty-web';

import type { Theme } from '../../shared/theme-types';
import type { TerminalEngineHandle, TerminalEngineProps } from '../types/terminalEngine';
import { isMacOSPlatform } from '../utils/platformUtils';
import { captureException } from '../utils/sentry';

const DEFAULT_FONT_SIZE = 14;
const INIT_FAILURE_MESSAGE =
	'Ghostty terminal failed to initialize. Switch to xterm.js in Settings > Display.';

let searchWarningLogged = false;

let ghosttyInitPromise: Promise<void> | null = null;

function ensureGhosttyInitialized(): Promise<void> {
	if (!ghosttyInitPromise) {
		ghosttyInitPromise = init().catch((error) => {
			ghosttyInitPromise = null;
			throw error;
		});
	}

	return ghosttyInitPromise;
}

/**
 * Wraps a link provider so that link activation uses Maestro's IPC bridge
 * (`window.maestro.shell.openExternal`) instead of `window.open`, which
 * does not work correctly inside Electron.
 */
function wrapLinkProvider(provider: ILinkProvider): ILinkProvider {
	return {
		provideLinks(y: number, callback: (links: ILink[] | undefined) => void) {
			provider.provideLinks(y, (links) => {
				if (!links) {
					callback(undefined);
					return;
				}

				const wrapped = links.map((link) => ({
					...link,
					activate(_event: MouseEvent) {
						if (link.text) {
							void window.maestro.shell.openExternal(link.text);
						}
					},
				}));
				callback(wrapped);
			});
		},
		dispose() {
			provider.dispose?.();
		},
	};
}

/**
 * Word-navigation escape sequences sent for Option+Arrow on macOS.
 * ESC b = backward-word, ESC f = forward-word (readline / zsh defaults).
 */
const WORD_LEFT = '\x1bb';
const WORD_RIGHT = '\x1bf';

/**
 * Evaluate a keyboard event fired inside the Ghostty terminal.
 *
 * Return semantics match ghostty-web's `attachCustomKeyEventHandler`:
 *   `true`  → prevent Ghostty from handling the key (pass to window / write manually)
 *   `false` → let Ghostty process the key normally
 *
 * The logic mirrors what xterm.js consumers typically do with
 * `attachCustomKeyEventHandler` / `evaluateCustomKeyEvent`, adapted for
 * Ghostty's inverted return convention.
 */
function evaluateKeyEvent(event: KeyboardEvent, sessionId: string): boolean {
	const isMac = isMacOSPlatform();

	// ── Maestro app shortcuts (Cmd+key / Ctrl+key on non-Mac) ──
	// On macOS Cmd (metaKey) is *never* a terminal control sequence, so pass
	// every Cmd-chord through to the window-level handler.
	if (isMac && event.metaKey) {
		return true;
	}

	// On non-macOS, Ctrl is used both for terminal control (Ctrl+C) and app
	// shortcuts (Ctrl+T). The convention: Ctrl+Shift is always a Maestro
	// shortcut, and Meta (Windows/Super key) combos are also Maestro shortcuts.
	if (!isMac) {
		if (event.metaKey) return true;
		if (event.ctrlKey && event.shiftKey) return true;
		if (event.ctrlKey && event.altKey) return true;
	}

	// ── Option+Arrow word navigation (macOS) ──
	// macOS terminals translate Option+Left/Right into backward/forward-word
	// escape sequences. Ghostty may not emit these for the host PTY, so we
	// write them manually and tell Ghostty to ignore the keypress.
	if (isMac && event.altKey && !event.metaKey && !event.ctrlKey) {
		if (event.key === 'ArrowLeft') {
			void window.maestro.process.write(sessionId, WORD_LEFT);
			return true;
		}
		if (event.key === 'ArrowRight') {
			void window.maestro.process.write(sessionId, WORD_RIGHT);
			return true;
		}
	}

	// ── Everything else → normal terminal input ──
	return false;
}

function isContainerVisible(container: HTMLElement | null): container is HTMLElement {
	if (!container) return false;

	return (
		container.offsetWidth > 0 ||
		container.offsetHeight > 0 ||
		container.clientWidth > 0 ||
		container.clientHeight > 0
	);
}

export function mapThemeToGhostty(theme: Theme): GhosttyTheme {
	const { colors, mode } = theme;

	return {
		background: colors.bgMain,
		foreground: colors.textMain,
		cursor: colors.accent,
		cursorAccent: colors.accentForeground,
		selectionBackground: colors.accentDim,
		selectionForeground: colors.textMain,
		black: mode === 'light' ? colors.textDim : colors.bgSidebar,
		red: colors.error,
		green: colors.success,
		yellow: colors.warning,
		blue: colors.accent,
		magenta: colors.accentText,
		cyan: mode === 'light' ? colors.accentText : colors.textDim,
		white: mode === 'light' ? colors.bgActivity : colors.textDim,
		brightBlack: colors.border,
		brightRed: colors.error,
		brightGreen: colors.success,
		brightYellow: colors.warning,
		brightBlue: colors.accent,
		brightMagenta: colors.accentText,
		brightCyan: mode === 'light' ? colors.textMain : colors.accentText,
		brightWhite: colors.textMain,
	};
}

export const GhosttyTerminal = forwardRef<TerminalEngineHandle, TerminalEngineProps>(
	function GhosttyTerminal(
		{ sessionId, theme, fontFamily, fontSize, onData, onResize, onTitleChange },
		ref
	) {
		const containerRef = useRef<HTMLDivElement>(null);
		const terminalRef = useRef<Terminal | null>(null);
		const fitAddonRef = useRef<FitAddon | null>(null);
		const onDataRef = useRef(onData);
		const onResizeRef = useRef(onResize);
		const onTitleChangeRef = useRef(onTitleChange);
		const themeRef = useRef(theme);
		const fontFamilyRef = useRef(fontFamily);
		const fontSizeRef = useRef(fontSize);
		const [initError, setInitError] = useState(false);

		onDataRef.current = onData;
		onResizeRef.current = onResize;
		onTitleChangeRef.current = onTitleChange;
		themeRef.current = theme;
		fontFamilyRef.current = fontFamily;
		fontSizeRef.current = fontSize;

		const fitTerminalToContainer = useCallback(() => {
			if (!fitAddonRef.current || !isContainerVisible(containerRef.current)) return;

			fitAddonRef.current.fit();
		}, []);

		useEffect(() => {
			let cancelled = false;
			let fitTimeoutId: number | null = null;
			let unsubscribeProcessData: (() => void) | null = null;
			const cleanupCallbacks: Array<() => void> = [];

			setInitError(false);

			void (async () => {
				try {
					await ensureGhosttyInitialized();

					if (cancelled || !containerRef.current) return;

					const terminal = new Terminal({
						fontFamily: fontFamilyRef.current,
						fontSize: fontSizeRef.current ?? DEFAULT_FONT_SIZE,
						theme: mapThemeToGhostty(themeRef.current),
					});
					const fitAddon = new FitAddon();

					terminalRef.current = terminal;
					fitAddonRef.current = fitAddon;

					const dataSubscription = terminal.onData((data) => {
							onDataRef.current?.(data);
							void window.maestro.process.write(sessionId, data).catch((error) => {
								captureException(error, {
									extra: {
										component: 'GhosttyTerminal',
										operation: 'process.write',
										sessionId,
									},
								});
							});
						});
					cleanupCallbacks.push(() => {
						dataSubscription.dispose();
					});

					const titleSubscription = terminal.onTitleChange((title) => {
						onTitleChangeRef.current?.(title);
					});
					cleanupCallbacks.push(() => {
						titleSubscription.dispose();
					});

					const resizeSubscription = terminal.onResize(({ cols, rows }) => {
							onResizeRef.current?.(cols, rows);
							void window.maestro.process.resize(sessionId, cols, rows).catch((error) => {
								captureException(error, {
									extra: {
										component: 'GhosttyTerminal',
										operation: 'process.resize',
										sessionId,
										cols,
										rows,
									},
								});
							});
						});
					cleanupCallbacks.push(() => {
						resizeSubscription.dispose();
					});

					terminal.loadAddon(fitAddon);
					terminal.open(containerRef.current);

					// Intercept keyboard events so Maestro app shortcuts
					// (Cmd+T, Cmd+K, etc.) bubble to the window-level handler
					// instead of being consumed by the terminal.
					terminal.attachCustomKeyEventHandler((event) =>
						evaluateKeyEvent(event, sessionId)
					);

					// Register link providers so URLs and OSC 8 hyperlinks are
					// clickable. The built-in providers use window.open() which
					// doesn't work in Electron, so we wrap them to route through
					// Maestro's IPC bridge instead.
					terminal.registerLinkProvider(
						wrapLinkProvider(new UrlRegexProvider(terminal))
					);
					terminal.registerLinkProvider(
						wrapLinkProvider(new OSC8LinkProvider(terminal))
					);

					fitAddon.observeResize();

					unsubscribeProcessData = window.maestro.process.onData((incomingSessionId, data) => {
						if (incomingSessionId !== sessionId) return;

						terminal.write(data);
					});

					fitTimeoutId = window.setTimeout(() => {
						fitTerminalToContainer();
					}, 0);
				} catch (error) {
					if (cancelled) return;

					captureException(error, {
						extra: {
							component: 'GhosttyTerminal',
							operation: 'initialize',
							sessionId,
						},
					});
					setInitError(true);
				}
			})();

			return () => {
				cancelled = true;

				if (fitTimeoutId !== null) {
					window.clearTimeout(fitTimeoutId);
				}

				unsubscribeProcessData?.();

				for (const cleanup of cleanupCallbacks) {
					cleanup();
				}

				terminalRef.current?.dispose();
				terminalRef.current = null;
				fitAddonRef.current = null;
			};
		}, [fitTerminalToContainer, sessionId]);

		// Best-effort runtime theme update. ghostty-web 0.4.0 warns that theme
		// changes after open() are "not yet fully supported" — some palette
		// entries may not repaint until new content is written. We intentionally
		// avoid disposing/re-creating the terminal here because that would wipe
		// the in-memory scrollback buffer for an active PTY tab. New terminal
		// tabs always pick up the current theme in full via the constructor.
		useEffect(() => {
			if (!terminalRef.current) return;

			terminalRef.current.options.theme = mapThemeToGhostty(theme);
		}, [theme]);

		useEffect(() => {
			if (!terminalRef.current) return;

			terminalRef.current.options.fontFamily = fontFamily;
			terminalRef.current.options.fontSize = fontSize ?? DEFAULT_FONT_SIZE;
			fitTerminalToContainer();
		}, [fitTerminalToContainer, fontFamily, fontSize]);

		useImperativeHandle(
			ref,
			() => ({
				write: (data) => {
					terminalRef.current?.write(data);
				},
				focus: () => {
					terminalRef.current?.focus();
				},
				clear: () => {
					terminalRef.current?.clear();
				},
				scrollToBottom: () => {
					terminalRef.current?.scrollToBottom();
				},
				search: () => {
					if (!searchWarningLogged) {
						searchWarningLogged = true;
						console.info(
							'[GhosttyTerminal] Search is not yet supported by ghostty-web 0.4.0'
						);
					}
					return false;
				},
				searchNext: () => {
					if (!searchWarningLogged) {
						searchWarningLogged = true;
						console.info(
							'[GhosttyTerminal] Search is not yet supported by ghostty-web 0.4.0'
						);
					}
					return false;
				},
				searchPrevious: () => {
					if (!searchWarningLogged) {
						searchWarningLogged = true;
						console.info(
							'[GhosttyTerminal] Search is not yet supported by ghostty-web 0.4.0'
						);
					}
					return false;
				},
				getSelection: () => terminalRef.current?.getSelection() ?? '',
				resize: () => {
					fitTerminalToContainer();
				},
				refresh: () => {
					fitTerminalToContainer();
				},
			}),
			[fitTerminalToContainer]
		);

		return (
			<div
				style={{
					width: '100%',
					height: '100%',
					position: 'relative',
					overflow: 'hidden',
					backgroundColor: theme.colors.bgMain,
				}}
			>
				<div
					ref={containerRef}
					data-testid="ghostty-terminal"
					style={{
						width: '100%',
						height: '100%',
						display: initError ? 'none' : 'block',
					}}
				/>
				{initError ? (
					<div
						role="alert"
						style={{
							position: 'absolute',
							inset: 0,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							padding: '1rem',
							textAlign: 'center',
							color: theme.colors.textMain,
							backgroundColor: theme.colors.bgMain,
						}}
					>
						{INIT_FAILURE_MESSAGE}
					</div>
				) : null}
			</div>
		);
	}
);
