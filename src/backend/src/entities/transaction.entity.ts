import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToMany, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Listing } from './listing.entity';
import { Associate } from './associate.entity';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  transactionNumber: string;

  @ManyToOne(() => Listing)
  listing: Listing;

  @Column({ nullable: true })
  transactionStatus: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  soldPrice: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  contractGCIExclVAT: number;

  @Column({ type: 'date', nullable: true })
  transactionDate: Date;

  @Column({ type: 'date', nullable: true })
  statusChangeDate: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Relations
  // @OneToMany(() => TransactionAssociate, ta => ta.transaction)
  // transactionAssociates: TransactionAssociate[];
}