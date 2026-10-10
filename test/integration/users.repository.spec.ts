import { UsersRepository } from '../../src/users/users.repository';
import { aUser } from '../testkit/builders';
import { useRollbackTransaction } from '../testkit/transaction';

describe('UsersRepository (Postgres)', () => {
    const db = useRollbackTransaction();
    const users = () => new UsersRepository(db());

    it('creates a user and reads it back by id', async () => {
        const created = await users().create(aUser({ fullName: 'Олена Кравченко' }));

        const found = await users().findById(created.id);

        expect(found).toEqual(created);
        expect(found?.fullName).toBe('Олена Кравченко');
    });

    it('returns null for a missing user', async () => {
        expect(await users().findById(999_999)).toBeNull();
    });

    it('rejects a duplicate email with unique violation 23505', async () => {
        const user = aUser();
        await users().create(user);

        await expect(users().create(aUser({ email: user.email }))).rejects.toMatchObject({
            code: '23505',
            constraint: expect.stringMatching(/^UQ_/),
        });
    });
});
