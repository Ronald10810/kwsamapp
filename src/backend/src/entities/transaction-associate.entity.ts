import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Transaction } from './transaction.entity';
import { Associate } from './associate.entity';

@Entity('transaction_associates')
export class TransactionAssociate {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Transaction)
  transaction: Transaction;

  @ManyToOne(() => Associate)
  associate: Associate;

  @Column()
  associateType: string; // e.g., 'Seller Agent', 'Buyer Agent'

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  commissionPercentage: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  commissionAmount: number;

  @Column({ nullable: true })
  marketCenterId: number;

  @Column({ nullable: true })
  teamId: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}