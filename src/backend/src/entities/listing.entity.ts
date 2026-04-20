import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToMany, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Associate } from './associate.entity';

@Entity('listings')
export class Listing {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  listingNumber: string;

  @Column()
  streetNumber: string;

  @Column()
  streetName: string;

  @Column({ nullable: true })
  unitNumber: string;

  @Column({ nullable: true })
  erfNumber: string;

  @Column()
  city: string;

  @Column()
  province: string;

  @Column()
  country: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  price: number;

  @Column({ default: false })
  isPOA: boolean;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  propertyType: string;

  @Column({ default: 0 })
  bedrooms: number;

  @Column({ default: 0 })
  bathrooms: number;

  @Column({ default: 0 })
  garages: number;

  @Column({ nullable: true })
  listingStatus: string;

  @Column({ nullable: true })
  saleOrRent: string;

  @Column({ nullable: true })
  primaryAgentId: number;

  @Column({ nullable: true })
  p24Reference: number;

  @Column({ nullable: true })
  kwwReference: string;

  @Column({ nullable: true })
  lightstonePropertyId: number;

  @ManyToOne(() => Associate, { nullable: true })
  primaryAgent: Associate;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Relations to be expanded
}