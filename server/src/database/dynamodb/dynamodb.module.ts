import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { dynamoDbConfig } from '../../config/dynamodb.config.js';
import { DYNAMODB_CLIENT, DYNAMODB_TABLE_NAME } from './dynamodb.constants.js';

// Provides the DynamoDB client and table name that ElectroDB entities are
// built with: `new Entity(schema, { client, table })`.
@Module({
  imports: [ConfigModule.forFeature(dynamoDbConfig)],
  providers: [
    {
      provide: DYNAMODB_CLIENT,
      inject: [dynamoDbConfig.KEY],
      useFactory: (config: ConfigType<typeof dynamoDbConfig>) =>
        new DynamoDBClient({
          region: config.region,
          endpoint: config.endpoint,
        }),
    },
    {
      provide: DYNAMODB_TABLE_NAME,
      inject: [dynamoDbConfig.KEY],
      useFactory: (config: ConfigType<typeof dynamoDbConfig>) =>
        config.tableName,
    },
  ],
  exports: [DYNAMODB_CLIENT, DYNAMODB_TABLE_NAME],
})
export class DynamoDbModule implements OnApplicationShutdown {
  constructor(
    @Inject(DYNAMODB_CLIENT) private readonly client: DynamoDBClient,
  ) {}

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
