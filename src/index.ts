import * as utils from './utils';

export interface Env {
	DB: D1Database;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		const method = request.method;
		const path = url.pathname.replace(/[/]$/, '');

		if (path !== '/api/check' && path !== '') {
			return utils.toError(`Unknown "${path}" URL; try "/api/check" instead.`, 404);
		}

		if (path === '') {
			return utils.reply({
				hi: 'welcome to antiphishing api',
				'how to use?': `https://${request.headers.get('host')}/api/check?url=example.com`,
			});
		}

		if (method !== 'GET') {
			return utils.toError('Method not allowed.', 405);
		}

		const searchurl = (url.searchParams.get('url') || '').trim().toLowerCase();
		if (!searchurl) {
			return utils.toError('Missing URL parameter.', 400);
		}
		try {
			const type = await env.DB.prepare('SELECT type FROM fishes WHERE url = ?').bind(searchurl).first<string>('type');
			if (type !== null) {
				return utils.reply({
					bad: 'yes',
					type: type,
					domain: searchurl,
				});
			}
			return utils.reply({
				bad: 'no',
			});
		} catch (err) {
			const msg = (err as Error).message || 'Error with query.';
			return utils.toError(msg, 500);
		}
	},
};
