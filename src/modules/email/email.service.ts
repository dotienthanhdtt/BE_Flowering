import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { AppConfiguration } from '../../config/app-configuration';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter;

  constructor(private configService: ConfigService<AppConfiguration>) {
    const smtp = this.configService.get('smtp', { infer: true })!;
    this.transporter = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass },
    });
  }

  async sendOtp(to: string, otp: string): Promise<void> {
    const from = this.configService.get('smtp', { infer: true })!.from;
    await this.transporter.sendMail({
      from,
      to,
      subject: 'Your password reset code',
      text: `Your verification code is: ${otp}\n\nThis code expires in 10 minutes.`,
      html: `<p>Your verification code is: <strong>${otp}</strong></p><p>This code expires in 10 minutes.</p>`,
    });
    this.logger.log(`OTP email sent to ${to.split('@')[0]}@***`);
  }
}
