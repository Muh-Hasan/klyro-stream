import type { RequestHandler, Response } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { env } from '../config/env.js';
import type { User } from '../repositories/user.repository.js';
import * as authService from '../services/auth.service.js';
import { setRefreshCookie } from '../utils/cookies.js';
import { oauthStateStore } from '../utils/oauth-state.js';
import { signRefreshToken } from '../utils/tokens.js';

type FailureInfo = { code?: string } | undefined;

passport.use(
  new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: env.GOOGLE_CALLBACK_URL,
      scope: ['openid', 'email', 'profile'],
      pkce: true,
      state: true,
      store: oauthStateStore,
    },
    (_accessToken, _refreshToken, profile, done) => {
      const email = profile.emails?.[0];
      authService
        .signInWithGoogle({
          sub: profile.id,
          email: email?.value,
          emailVerified: String(email?.verified) === 'true',
        })
        .then((result) =>
          'user' in result ? done(null, result.user) : done(null, false, { code: result.error }),
        )
        .catch((err: unknown) => done(err as Error));
    },
  ),
);

const redirectWithError = (res: Response, code: string) => {
  const url = new URL(env.OAUTH_SUCCESS_REDIRECT);
  url.searchParams.set('error', code);
  res.redirect(url.toString());
};

export const googleAuthStart: RequestHandler = passport.authenticate('google', {
  session: false,
}) as RequestHandler;

export const googleAuthCallback: RequestHandler = (req, res, next) => {
  const handler = passport.authenticate(
    'google',
    { session: false },
    (err: unknown, user: User | false, info: FailureInfo) => {
      if (err) {
        req.log.error({ err }, 'google sign-in failed');
        return redirectWithError(res, 'oauth_failed');
      }
      if (!user) {
        const cancelled = req.query.error === 'access_denied';
        return redirectWithError(res, cancelled ? 'access_denied' : (info?.code ?? 'oauth_failed'));
      }
      setRefreshCookie(res, signRefreshToken(user.id, user.tokenVersion));
      res.redirect(env.OAUTH_SUCCESS_REDIRECT);
    },
  ) as RequestHandler;
  handler(req, res, next);
};
