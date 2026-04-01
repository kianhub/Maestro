import React, {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from 'react';
import { FitAddon, Terminal, init, type ITheme as GhosttyTheme } from 'ghostty-web';

import type { Theme } from '../../shared/theme-types';
import type { TerminalEngineHandle, TerminalEngineProps } from '../types/terminalEngine';
import { captureException } from '../utils/sentry';

const DEFAULT_FONT_SIZE = 14;
const INIT_FAILURE_MESSAGE =
	'Ghostty terminal failed to initialize. Switch to xterm.js in Settings > Display.';

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
				search: () => false,
				searchNext: () => false,
				searchPrevious: () => false,
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
