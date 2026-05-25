import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DeepPartial,
  DeleteResult,
  FindOptionsWhere,
  QueryDeepPartialEntity,
  Repository,
  UpdateResult,
} from 'typeorm';
import { OrderEntity } from '../../database/entities';

@Injectable()
export class OrderRepository {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly repository: Repository<OrderEntity>,
  ) {}

  create(data: DeepPartial<OrderEntity>): Promise<OrderEntity> {
    return this.repository.save(this.repository.create(data));
  }

  findAll(): Promise<OrderEntity[]> {
    return this.repository.find();
  }

  findBy(
    where: FindOptionsWhere<OrderEntity> | FindOptionsWhere<OrderEntity>[],
  ): Promise<OrderEntity[]> {
    return this.repository.findBy(where);
  }

  findOneBy(where: FindOptionsWhere<OrderEntity>): Promise<OrderEntity | null> {
    return this.repository.findOneBy(where);
  }

  update(
    where: FindOptionsWhere<OrderEntity> | FindOptionsWhere<OrderEntity>[],
    data: QueryDeepPartialEntity<OrderEntity>,
  ): Promise<UpdateResult> {
    return this.repository.update(where, data);
  }

  delete(
    where: FindOptionsWhere<OrderEntity> | FindOptionsWhere<OrderEntity>[],
  ): Promise<DeleteResult> {
    return this.repository.delete(where);
  }
}
