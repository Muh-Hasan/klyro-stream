import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
});

type Mail = { to: string; subject: string; text: string; html?: string };

export const sendMail = async (mail: Mail): Promise<void> => {
  await transport.sendMail({ from: env.MAIL_FROM, ...mail });
};

export const closeMailer = () => {
  transport.close();
};
