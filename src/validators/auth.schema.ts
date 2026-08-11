import * as z from 'zod';

export const RegisterSchema = z.object({
  email: z.email({ error: 'Invalid email address' }),
  password: z
    .string({ error: 'This field is required' })
    .min(8, { error: 'Password must be at least 8 characters long' })
    .refine((val) => /[A-Z]/.test(val), {
      error: 'Password must contain at least one uppercase letter',
    })
    .refine((val) => /[a-z]/.test(val), {
      error: 'Password must contain at least one lowercase letter',
    })
    .refine((val) => /\d/.test(val), { error: 'Password must contain at least one number' })
    .refine((val) => /[@$!%*?&]/.test(val), {
      error: 'Password must contain at least one special character (@$!%*?&)',
    }),
});

export const LoginSchema = z.object({
  email: z.email({ error: 'Invalid email address' }),
  password: z
    .string({ error: 'This field is required' })
    .nonempty({ error: 'This field is required' }),
});

export type LoginSchemaType = z.infer<typeof LoginSchema>
export type RegisterSchemaType = z.infer<typeof RegisterSchema>