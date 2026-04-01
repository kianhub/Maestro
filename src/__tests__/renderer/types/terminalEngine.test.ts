import { describe, it, expect } from 'vitest';

import { THEMES } from '../../../shared/themes';
import type { TerminalEngineHandle, TerminalEngineProps } from '../../../renderer/types';

describe('terminal engine types', () => {
	it('supports the shared terminal engine props contract', () => {
		const props: TerminalEngineProps = {
			sessionId: 'session-1',
			theme: THEMES.dracula,
			fontFamily: 'monospace',
			fontSize: 14,
			onData: () => undefined,
			onResize: () => undefined,
			onTitleChange: () => undefined,
		};

		expect(props.sessionId).toBe('session-1');
		expect(props.theme).toBe(THEMES.dracula);
		expect(props.fontFamily).toBe('monospace');
		expect(props.fontSize).toBe(14);
	});

	it('supports the shared terminal engine handle contract', () => {
		let lastQuery = '';

		const handle: TerminalEngineHandle = {
			write: () => undefined,
			focus: () => undefined,
			clear: () => undefined,
			scrollToBottom: () => undefined,
			search: (query) => {
				lastQuery = query;
				return query.length > 0;
			},
			searchNext: () => true,
			searchPrevious: () => false,
			getSelection: () => 'selected text',
			resize: () => undefined,
			refresh: () => undefined,
		};

		expect(handle.search('needle')).toBe(true);
		expect(lastQuery).toBe('needle');
		expect(handle.searchNext()).toBe(true);
		expect(handle.searchPrevious()).toBe(false);
		expect(handle.getSelection()).toBe('selected text');
	});
});
