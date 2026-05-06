import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { AppConfiguration } from '../../config/app-configuration';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private initialized = false;

  constructor(private configService: ConfigService<AppConfiguration>) {}

  onModuleInit(): void {
    try {
      const smtp = this.configService.get('smtp', { infer: true });
      if (!smtp?.host || !smtp?.user || !smtp?.pass) {
        this.logger.warn('SMTP config incomplete — email service disabled');
        return;
      }
      this.transporter = createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: { user: smtp.user, pass: smtp.pass },
      });
      this.initialized = true;
    } catch (err) {
      this.logger.warn(`Email service init failed: ${(err as Error).message}`);
    }
  }

  async sendOtp(to: string, otp: string): Promise<void> {
    if (!this.initialized || !this.transporter) {
      this.logger.warn('sendOtp called but email service is not initialized');
      throw new ServiceUnavailableException('Email service unavailable');
    }
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
