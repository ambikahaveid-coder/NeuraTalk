import 'package:flutter_test/flutter_test.dart';
import 'package:neuratalk/services/media_store.dart';

void main() {
  group('MediaStore file types', () {
    test('names the right type for common files', () {
      expect(MediaStore.contentTypeFor('IMG_1.JPG'), 'image/jpeg');
      expect(MediaStore.contentTypeFor('party.gif'), 'image/gif');
      expect(MediaStore.contentTypeFor('IMG_2.heic'), 'image/heic');
      expect(MediaStore.contentTypeFor('clip.mov'), 'video/quicktime');
      expect(MediaStore.contentTypeFor('report.pdf'), 'application/pdf');
      expect(MediaStore.contentTypeFor('letter.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(MediaStore.contentTypeFor('sheet.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(MediaStore.contentTypeFor('drawing.dwg'), 'application/octet-stream');
      expect(MediaStore.contentTypeFor('noextension'), 'application/octet-stream');
    });

    test('sorts files into photo / video / audio / document', () {
      expect(MediaStore.kindOf('a.png'), MediaKind.image);
      expect(MediaStore.kindOf('a.mp4'), MediaKind.video);
      expect(MediaStore.kindOf('a.m4a'), MediaKind.audio);
      expect(MediaStore.kindOf('a.pptx'), MediaKind.document);
      expect(MediaStore.kindOf('weird.bin', mime: 'video/mp4'), MediaKind.video);
    });

    test('blocks apps and scripts like the server does', () {
      for (final name in ['setup.exe', 'game.apk', 'page.html', 'logo.svg', 'run.BAT']) {
        expect(MediaStore.isBlocked(name), isTrue, reason: name);
      }
      expect(MediaStore.isBlocked('report.pdf'), isFalse);
    });

    test('formats sizes for the bubble', () {
      expect(MediaStore.formatSize(null), '');
      expect(MediaStore.formatSize(512), '512 B');
      expect(MediaStore.formatSize(830 * 1024), '830 KB');
      expect(MediaStore.formatSize(2.4 * 1024 * 1024), '2.4 MB');
      expect(MediaStore.formatSize(150 * 1024 * 1024), '150 MB');
    });
  });
}
