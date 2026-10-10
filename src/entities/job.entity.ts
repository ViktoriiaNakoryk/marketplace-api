import {
    Check,
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('jobs')
@Check(`"status" IN ('pending', 'done', 'failed')`)
export class Job {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id: string;

    @Column({ type: 'text' })
    type: string;

    @Column({ type: 'jsonb', default: {} })
    payload: Record<string, unknown>;

    @Index()
    @Column({ type: 'text', default: 'pending' })
    status: 'pending' | 'done' | 'failed';

    @Column({ type: 'int', default: 0 })
    processed: number;

    @Column({ type: 'text', nullable: true })
    worker: string | null;

    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date;
}
