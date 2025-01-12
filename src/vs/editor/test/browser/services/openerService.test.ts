/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { OpenerService } from 'vs/editor/browser/services/openerService';
import { TestCodeEditorService } from 'vs/editor/test/browser/editorTestServices';
import { CommandsRegistry, ICommandService, NullCommandService } from 'vs/platform/commands/common/commands';
import { matchesScheme } from 'vs/platform/opener/common/opener';

suite('OpenerService', function () {
	const editorService = new TestCodeEditorService();

	let lastCommand: { id: string; args: any[] } | undefined;

	const commandService = new (class implements ICommandService {
		declare readonly _serviceBrand: undefined;
		onWillExecuteCommand = () => Disposable.None;
		onDidExecuteCommand = () => Disposable.None;
		executeCommand(id: string, ...args: any[]): Promise<any> {
			lastCommand = { id, args };
			return Promise.resolve(undefined);
		}
	})();

	setup(function () {
		lastCommand = undefined;
	});

	test('delegate to editorService, scheme:///fff', async function () {
		const openerService = new OpenerService(editorService, NullCommandService);
		await openerService.open(URI.parse('another:///somepath'));
		assert.strictEqual(editorService.lastInput!.options!.selection, undefined);
	});

	test('delegate to editorService, scheme:///fff#L123', async function () {
		const openerService = new OpenerService(editorService, NullCommandService);

		await openerService.open(URI.parse('file:///somepath#L23'));
		assert.strictEqual(editorService.lastInput!.options!.selection!.startLineNumber, 23);
		assert.strictEqual(editorService.lastInput!.options!.selection!.startColumn, 1);
		assert.strictEqual(editorService.lastInput!.options!.selection!.endLineNumber, undefined);
		assert.strictEqual(editorService.lastInput!.options!.selection!.endColumn, undefined);
		assert.strictEqual(editorService.lastInput!.resource.fragment, '');

		await openerService.open(URI.parse('another:///somepath#L23'));
		assert.strictEqual(editorService.lastInput!.options!.selection!.startLineNumber, 23);
		assert.strictEqual(editorService.lastInput!.options!.selection!.startColumn, 1);

		await openerService.open(URI.parse('another:///somepath#L23,45'));
		assert.strictEqual(editorService.lastInput!.options!.selection!.startLineNumber, 23);
		assert.strictEqual(editorService.lastInput!.options!.selection!.startColumn, 45);
		assert.strictEqual(editorService.lastInput!.options!.selection!.endLineNumber, undefined);
		assert.strictEqual(editorService.lastInput!.options!.selection!.endColumn, undefined);
		assert.strictEqual(editorService.lastInput!.resource.fragment, '');
	});

	test('delegate to editorService, scheme:///fff#123,123', async function () {
		const openerService = new OpenerService(editorService, NullCommandService);

		await openerService.open(URI.parse('file:///somepath#23'));
		assert.strictEqual(editorService.lastInput!.options!.selection!.startLineNumber, 23);
		assert.strictEqual(editorService.lastInput!.options!.selection!.startColumn, 1);
		assert.strictEqual(editorService.lastInput!.options!.selection!.endLineNumber, undefined);
		assert.strictEqual(editorService.lastInput!.options!.selection!.endColumn, undefined);
		assert.strictEqual(editorService.lastInput!.resource.fragment, '');

		await openerService.open(URI.parse('file:///somepath#23,45'));
		assert.strictEqual(editorService.lastInput!.options!.selection!.startLineNumber, 23);
		assert.strictEqual(editorService.lastInput!.options!.selection!.startColumn, 45);
		assert.strictEqual(editorService.lastInput!.options!.selection!.endLineNumber, undefined);
		assert.strictEqual(editorService.lastInput!.options!.selection!.endColumn, undefined);
		assert.strictEqual(editorService.lastInput!.resource.fragment, '');
	});

	test('delegate to commandsService, command:someid', async function () {
		const openerService = new OpenerService(editorService, commandService);

		const id = `aCommand${Math.random()}`;
		CommandsRegistry.registerCommand(id, function () { });

		await openerService.open(URI.parse('command:' + id));
		assert.strictEqual(lastCommand!.id, id);
		assert.strictEqual(lastCommand!.args.length, 0);

		await openerService.open(URI.parse('command:' + id).with({ query: '123' }));
		assert.strictEqual(lastCommand!.id, id);
		assert.strictEqual(lastCommand!.args.length, 1);
		// TODO @jrieken is this ok that its converting the string to a number in the args?
		assert.equal(lastCommand!.args[0], '123');

		await openerService.open(URI.parse('command:' + id).with({ query: JSON.stringify([12, true]) }));
		assert.strictEqual(lastCommand!.id, id);
		assert.strictEqual(lastCommand!.args.length, 2);
		assert.strictEqual(lastCommand!.args[0], 12);
		assert.strictEqual(lastCommand!.args[1], true);
	});

	test('links are protected by validators', async function () {
		const openerService = new OpenerService(editorService, commandService);

		openerService.registerValidator({ shouldOpen: () => Promise.resolve(false) });

		const httpResult = await openerService.open(URI.parse('https://www.microsoft.com'));
		const httpsResult = await openerService.open(URI.parse('https://www.microsoft.com'));
		assert.strictEqual(httpResult, false);
		assert.strictEqual(httpsResult, false);
	});

	test('links validated by validators go to openers', async function () {
		const openerService = new OpenerService(editorService, commandService);

		openerService.registerValidator({ shouldOpen: () => Promise.resolve(true) });

		let openCount = 0;
		openerService.registerOpener({
			open: (resource: URI) => {
				openCount++;
				return Promise.resolve(true);
			}
		});

		await openerService.open(URI.parse('http://microsoft.com'));
		assert.strictEqual(openCount, 1);
		await openerService.open(URI.parse('https://microsoft.com'));
		assert.strictEqual(openCount, 2);
	});

	test('links aren\'t manipulated before being passed to validator: PR #118226', async function () {
		const openerService = new OpenerService(editorService, commandService);

		openerService.registerValidator({
			shouldOpen: (resource) => {
				// We don't want it to convert strings into URIs
				assert.strictEqual(resource instanceof URI, false);
				return Promise.resolve(false);
			}
		});
		await openerService.open('https://wwww.microsoft.com');
		await openerService.open('https://www.microsoft.com??params=CountryCode%3DUSA%26Name%3Dvscode"');
	});

	test('links validated by multiple validators', async function () {
		const openerService = new OpenerService(editorService, commandService);

		let v1 = 0;
		openerService.registerValidator({
			shouldOpen: () => {
				v1++;
				return Promise.resolve(true);
			}
		});

		let v2 = 0;
		openerService.registerValidator({
			shouldOpen: () => {
				v2++;
				return Promise.resolve(true);
			}
		});

		let openCount = 0;
		openerService.registerOpener({
			open: (resource: URI) => {
				openCount++;
				return Promise.resolve(true);
			}
		});

		await openerService.open(URI.parse('http://microsoft.com'));
		assert.strictEqual(openCount, 1);
		assert.strictEqual(v1, 1);
		assert.strictEqual(v2, 1);
		await openerService.open(URI.parse('https://microsoft.com'));
		assert.strictEqual(openCount, 2);
		assert.strictEqual(v1, 2);
		assert.strictEqual(v2, 2);
	});

	test('links invalidated by first validator do not continue validating', async function () {
		const openerService = new OpenerService(editorService, commandService);

		let v1 = 0;
		openerService.registerValidator({
			shouldOpen: () => {
				v1++;
				return Promise.resolve(false);
			}
		});

		let v2 = 0;
		openerService.registerValidator({
			shouldOpen: () => {
				v2++;
				return Promise.resolve(true);
			}
		});

		let openCount = 0;
		openerService.registerOpener({
			open: (resource: URI) => {
				openCount++;
				return Promise.resolve(true);
			}
		});

		await openerService.open(URI.parse('http://microsoft.com'));
		assert.strictEqual(openCount, 0);
		assert.strictEqual(v1, 1);
		assert.strictEqual(v2, 0);
		await openerService.open(URI.parse('https://microsoft.com'));
		assert.strictEqual(openCount, 0);
		assert.strictEqual(v1, 2);
		assert.strictEqual(v2, 0);
	});

	test('matchesScheme', function () {
		assert.ok(matchesScheme('https://microsoft.com', 'https'));
		assert.ok(matchesScheme('http://microsoft.com', 'http'));
		assert.ok(matchesScheme('hTTPs://microsoft.com', 'https'));
		assert.ok(matchesScheme('httP://microsoft.com', 'http'));
		assert.ok(matchesScheme(URI.parse('https://microsoft.com'), 'https'));
		assert.ok(matchesScheme(URI.parse('http://microsoft.com'), 'http'));
		assert.ok(matchesScheme(URI.parse('hTTPs://microsoft.com'), 'https'));
		assert.ok(matchesScheme(URI.parse('httP://microsoft.com'), 'http'));
		assert.ok(!matchesScheme(URI.parse('https://microsoft.com'), 'http'));
		assert.ok(!matchesScheme(URI.parse('htt://microsoft.com'), 'http'));
		assert.ok(!matchesScheme(URI.parse('z://microsoft.com'), 'http'));
	});
});
