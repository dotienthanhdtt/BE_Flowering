import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Language } from './language.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 255, name: 'password_hash', nullable: true })
  passwordHash?: string;

  @Column({ type: 'varchar', length: 50, name: 'auth_provider', nullable: true })
  authProvider?: string;

  @Column({ type: 'varchar', length: 255, name: 'provider_id', nullable: true })
  providerId?: string;

  // Uniqueness enforced via partial indexes in migration (WHERE col IS NOT NULL)
  @Column({ type: 'varchar', length: 255, name: 'google_provider_id', nullable: true })
  googleProviderId?: string;

  @Column({ type: 'varchar', length: 255, name: 'apple_provider_id', nullable: true })
  appleProviderId?: string;

  @Column({ type: 'varchar', length: 128, name: 'firebase_uid', nullable: true, unique: true })
  firebaseUid?: string;

  @Column({ type: 'boolean', name: 'email_verified', default: false })
  emailVerified!: boolean;

  @Column({ type: 'boolean', name: 'is_admin', default: false })
  isAdmin!: boolean;

  @Column({ type: 'varchar', length: 100, name: 'display_name', nullable: true })
  displayName?: string;

  @Column({ type: 'text', name: 'avatar_url', nullable: true })
  avatarUrl?: string;

  @Column({ type: 'varchar', length: 20, name: 'phone_number', nullable: true })
  phoneNumber?: string;

  @ManyToOne(() => Language, { nullable: true })
  @JoinColumn({ name: 'native_language_id' })
  nativeLanguage?: Language;

  @Column({ type: 'uuid', name: 'native_language_id', nullable: true })
  nativeLanguageId?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
