import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  success: boolean;
  data: T;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T> | StreamableFile> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T> | StreamableFile> {
    return next.handle().pipe(
      map((data) => {
        // A StreamableFile must be returned untouched so Nest can pipe it to
        // the response. Wrapping it in the success envelope JSON-serialises the
        // object instead of streaming the file, and the client silently
        // receives `{"success":true,"data":{"options":{},"logger":{...}}}`
        // with a 200 and the right Content-Type - a corrupt download that
        // looks like a successful one.
        //
        // Applies to every file-serving endpoint, present and future (private
        // document streaming today, PDF invoices later).
        if (data instanceof StreamableFile) return data;

        return { success: true, data };
      }),
    );
  }
}
