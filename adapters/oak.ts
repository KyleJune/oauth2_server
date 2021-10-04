import {
  AuthorizeParameters,
  OAuth2AuthorizeRequest,
  OAuth2Request,
  OAuth2Response,
} from "../context.ts";
import { AuthorizationCode } from "../models/authorization_code.ts";
import { ClientInterface } from "../models/client.ts";
import { ScopeInterface } from "../models/scope.ts";
import { Token } from "../models/token.ts";
import { OAuth2Server } from "../server.ts";
import { BodyForm, Context, Cookies, Middleware } from "./oak_deps.ts";

export class OakOAuth2Request<
  Client extends ClientInterface,
  User,
  Scope extends ScopeInterface,
> implements OAuth2Request<Client, User, Scope> {
  private context: Context;
  private _bodyCached: boolean;
  private _body?: Promise<URLSearchParams>;
  authorizedScope?: Scope;
  authorizationCode?: AuthorizationCode<Client, User, Scope>;
  authorizeParameters?: AuthorizeParameters;
  user?: User;
  token?: Token<Client, User, Scope>;

  constructor(context: Context) {
    this.context = context;
    this._bodyCached = false;
  }

  get url(): URL {
    return this.context.request.url;
  }

  get headers(): Headers {
    return this.context.request.headers;
  }

  get method(): string {
    return this.context.request.method;
  }

  get hasBody(): boolean {
    return this.context.request.hasBody;
  }

  get body(): Promise<URLSearchParams> | undefined {
    if (!this._bodyCached) {
      try {
        const body: BodyForm = this.context.request.body({ type: "form" });
        this._body = body.type === "form"
          ? body.value.catch(() => new URLSearchParams())
          : undefined;
      } catch {
        this._body = undefined;
      }
      this._bodyCached = true;
    }
    return this._body;
  }

  get cookies(): Cookies {
    return this.context.cookies;
  }
}

export type OakOAuth2AuthorizeRequest<
  Client extends ClientInterface,
  User,
  Scope extends ScopeInterface,
> =
  & OakOAuth2Request<Client, User, Scope>
  & OAuth2AuthorizeRequest<Client, User, Scope>;

export class OakOAuth2Response implements OAuth2Response {
  private context: Context;
  // deno-lint-ignore no-explicit-any
  private _body: any | Promise<any>;

  constructor(context: Context) {
    this.context = context;
  }

  get status(): number {
    return this.context.response.status;
  }
  set status(value: number) {
    this.context.response.status = value;
  }

  get headers(): Headers {
    return this.context.response.headers;
  }
  set headers(value: Headers) {
    this.context.response.headers = value;
  }

  // deno-lint-ignore no-explicit-any
  get body(): any | Promise<any> | (() => (any | Promise<any>)) {
    return this._body;
  }
  // deno-lint-ignore no-explicit-any
  set body(value: any | Promise<any> | (() => (any | Promise<any>))) {
    this.context.response.body = Promise.resolve(value) === value
      ? () => value
      : value;
    this._body = value;
  }

  redirect(url: string | URL): Promise<void> {
    this.context.response.redirect(url);
    return Promise.resolve();
  }
}

export interface OakOAuth2Options<
  Client extends ClientInterface,
  User,
  Scope extends ScopeInterface,
> {
  /** The OAuth2 server. */
  server: OAuth2Server<Client, User, Scope>;
  /** The key for storing OAuth2 state on the context's state. Defaults to "oauth2". */
  stateKey?: string;
  /**
   * Gets access token from request in a non standard way.
   * If function is not set or it resolves to null,
   * authenticate will check for access token in the authorization header or request body.
   */
  getAccessToken?: (
    request: OakOAuth2Request<Client, User, Scope>,
  ) => Promise<string | null>;
}

export interface OakOAuth2State<
  Client extends ClientInterface,
  User,
  Scope extends ScopeInterface,
> {
  request: OakOAuth2Request<Client, User, Scope>;
  response: OakOAuth2Response;
}
export class OakOAuth2<
  Client extends ClientInterface,
  User,
  Scope extends ScopeInterface,
> {
  private server: OAuth2Server<Client, User, Scope>;
  private stateKey: string;
  private getAccessToken: (
    request: OakOAuth2Request<Client, User, Scope>,
    requireRefresh?: boolean,
  ) => Promise<string | null>;

  constructor(options: OakOAuth2Options<Client, User, Scope>) {
    this.server = options.server;
    this.stateKey = options.stateKey ?? "oauth2";
    this.getAccessToken = options.getAccessToken ??
      (() => Promise.resolve(null));
  }

  protected getState(context: Context): OakOAuth2State<Client, User, Scope> {
    const state = context.state[this.stateKey] ?? {};
    if (!context.state[this.stateKey]) {
      context.state[this.stateKey] = state;
      state.request = new OakOAuth2Request(context);
      state.response = new OakOAuth2Response(context);
    }
    return state;
  }

  async getTokenForRequest(
    request: OakOAuth2Request<Client, User, Scope>,
  ): Promise<Token<Client, User, Scope> | undefined> {
    return await this.server.getTokenForRequest(request, this.getAccessToken)
      .catch(() => undefined);
  }

  getTokenForContext(
    context: Context,
  ): Promise<Token<Client, User, Scope> | undefined> {
    const state = this.getState(context);
    const { request } = state;
    return this.getTokenForRequest(request);
  }

  token(): Middleware {
    return async (context: Context) => {
      const state = this.getState(context);
      const { request, response } = state;
      return await this.server.token(request, response);
    };
  }

  authorize(
    setAuthorization: (
      request: OakOAuth2AuthorizeRequest<Client, User, Scope>,
    ) => Promise<void>,
    login: (
      request: OakOAuth2AuthorizeRequest<Client, User, Scope>,
      response: OakOAuth2Response,
    ) => Promise<void>,
    consent?: (
      request: OakOAuth2AuthorizeRequest<Client, User, Scope>,
      response: OakOAuth2Response,
    ) => Promise<void>,
  ): Middleware {
    return (context: Context) => {
      const state = this.getState(context);
      const { request, response } = state;
      return this.server.authorize(
        request,
        response,
        setAuthorization,
        login,
        consent,
      );
    };
  }

  authenticate(scope?: Scope | string): Middleware {
    const requiredScope = typeof scope === "string"
      ? this.server.Scope.from(scope)
      : scope;
    return (context: Context, next: () => Promise<unknown>) => {
      const state = this.getState(context);
      const { request, response } = state;
      return this.server.authenticate(
        request,
        response,
        next,
        this.getAccessToken,
        requiredScope,
      );
    };
  }
}
