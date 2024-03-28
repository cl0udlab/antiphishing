import * as Realm from 'realm-web';
import * as utils from './utils';

export interface Env {
	REALM_APPID: string;
	Token: string;
}

let App: Realm.App;

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		const method = request.method;
		const path = url.pathname.replace(/[/]$/, '');

		if (path !== '/api/check' && path !== '/') {
			return utils.toError(`Unknown "${path}" URL; try "/api/check" instead.`, 404);
		}

		if (path === '/') {
			return utils.reply({
				"hi": "welcome to antiphishing api",
				"how to use?": "https://<url>/api/check?url=example.com",
			});
		}

		App = App || new Realm.App(env.REALM_APPID);
		try {
			const credentials = Realm.Credentials.apiKey(env.Token);
			var user = await App.logIn(credentials);
			var client = user.mongoClient('mongodb-atlas');
		} catch (err) {
			return utils.toError('Error with authentication.', 500);
		}
		const collection = client.db('fishes').collection('antifish');
		try {
			if (method === 'GET') {
				const searchurl = url.searchParams.get('url') || '';
				if (!searchurl) {
					return utils.toError('Missing URL parameter.', 400);
				}
				const result = await collection.findOne({
					url: searchurl.toString(),
				});
				if (result) {
					return utils.reply({
						"bad": "yes",
						"type":result.type,
						"domain":result.url
					})
				} else {
					return utils.reply({
						"bad": "no",
					});
				}
			}

			if (method === 'POST') {
				const usercollection = client.db('users').collection('user');
				const theurl = url.searchParams.get('url');
				const type = url.searchParams.get('type');
				const token = request.headers.get('authorization');
				if (!token) {
					return utils.toError('Missing authorization header.', 400);
				}
				const user = await usercollection.findOne({
					token: token,
				});
				if (!user) {
					return utils.toError('Unauthorized.', 401);
				}
				return utils.reply(
					await collection.insertOne({
						url: theurl,
						type: type,
					})
				);
			}
			return utils.toError('Method not allowed.', 405);
		} catch (err) {
			const msg = (err as Error).message || 'Error with query.';
			return utils.toError(msg, 500);
		}
	},
};
