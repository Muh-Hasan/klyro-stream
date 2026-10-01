import { z } from 'zod';

export const email = z
  .email({
    error: (issue) =>
      issue.input === undefined
        ? 'The email is required.'
        : 'The email must be a valid email address.',
  })
  .max(320, 'The email must be at most 320 characters.')
  .transform((value) => value.toLowerCase());

const passwordRequired = (issue: { input?: unknown }) =>
  issue.input === undefined ? 'The password is required.' : 'The password must be a string.';

export const newPassword = z
  .string({ error: passwordRequired })
  .min(8, 'The password must be at least 8 characters.')
  .max(72, 'The password must be at most 72 characters.')
  .regex(/[A-Z]/, 'The password must contain an uppercase letter.')
  .regex(/[a-z]/, 'The password must contain a lowercase letter.')
  .regex(/\d/, 'The password must contain a number.');

export const registerSchemas = {
  body: z.object({ email, password: newPassword }),
};

export const loginSchemas = {
  body: z.object({
    email,
    password: z
      .string({ error: passwordRequired })
      .min(1, 'The password is required.')
      .max(72, 'The password must be at most 72 characters.'),
  }),
};

export const forgotPasswordSchemas = {
  body: z.object({ email }),
};

export const token = z
  .string({ error: 'The token is required.' })
  .min(1, 'The token is required.')
  .max(100, 'The token is invalid.');

export const resetPasswordSchemas = {
  body: z.object({ token, password: newPassword }),
};

export type RegisterInput = z.output<typeof registerSchemas.body>;
export type LoginInput = z.output<typeof loginSchemas.body>;
export type ForgotPasswordInput = z.output<typeof forgotPasswordSchemas.body>;
export type ResetPasswordInput = z.output<typeof resetPasswordSchemas.body>;
