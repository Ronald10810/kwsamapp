import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Associate } from './associate.entity';

@Entity('referrals')
export class Referral {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  referralNumber: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  referralType: string;

  @Column({ nullable: true })
  status: string;

  @ManyToOne(() => Associate, { nullable: true })
  referringAssociate: Associate;

  @ManyToOne(() => Associate, { nullable: true })
  receivingAssociate: Associate;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  commissionAmount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}