import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

export class DiscoverySearchDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  niche: string;
}
