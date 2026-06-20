import { IsString, IsNotEmpty, IsUrl } from 'class-validator';

export class CompetitorAnalyzeDto {
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_protocol: true }, { message: 'url must be a valid URL starting with http:// or https://' })
  url: string;
}
