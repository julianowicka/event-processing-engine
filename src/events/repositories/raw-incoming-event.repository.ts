import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DeepPartial,
  DeleteResult,
  FindManyOptions,
  FindOptionsWhere,
  QueryDeepPartialEntity,
  Repository,
  UpdateResult,
} from 'typeorm';
import { RawIncomingEventEntity } from '../../database/entities';

@Injectable()
export class RawIncomingEventRepository {
  constructor(
    @InjectRepository(RawIncomingEventEntity)
    private readonly repository: Repository<RawIncomingEventEntity>,
  ) {}

  create(
    data: DeepPartial<RawIncomingEventEntity>,
  ): Promise<RawIncomingEventEntity> {
    return this.repository.save(this.repository.create(data));
  }

  createMany(
    data: DeepPartial<RawIncomingEventEntity>[],
  ): Promise<RawIncomingEventEntity[]> {
    return this.repository.save(
      data.map((item) => this.repository.create(item)),
    );
  }

  findAll(): Promise<RawIncomingEventEntity[]> {
    return this.repository.find();
  }

  find(
    options: FindManyOptions<RawIncomingEventEntity>,
  ): Promise<RawIncomingEventEntity[]> {
    return this.repository.find(options);
  }

  findBy(
    where:
      | FindOptionsWhere<RawIncomingEventEntity>
      | FindOptionsWhere<RawIncomingEventEntity>[],
  ): Promise<RawIncomingEventEntity[]> {
    return this.repository.findBy(where);
  }

  findOneBy(
    where: FindOptionsWhere<RawIncomingEventEntity>,
  ): Promise<RawIncomingEventEntity | null> {
    return this.repository.findOneBy(where);
  }

  update(
    where:
      | FindOptionsWhere<RawIncomingEventEntity>
      | FindOptionsWhere<RawIncomingEventEntity>[],
    data: QueryDeepPartialEntity<RawIncomingEventEntity>,
  ): Promise<UpdateResult> {
    return this.repository.update(where, data);
  }

  delete(
    where:
      | FindOptionsWhere<RawIncomingEventEntity>
      | FindOptionsWhere<RawIncomingEventEntity>[],
  ): Promise<DeleteResult> {
    return this.repository.delete(where);
  }
}
