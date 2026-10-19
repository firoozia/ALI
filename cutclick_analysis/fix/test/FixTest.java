import com.padcod.cutclick.Utils.Fix;
import java.lang.reflect.Field;
import java.security.cert.*;
import java.io.*;
public class FixTest {
  static int fails=0;
  static void eq(Object a,Object b,String n){ if(a==null?b!=null:!a.equals(b)){fails++;System.out.println("FAIL "+n+": "+a+" != "+b);} else System.out.println("ok   "+n); }
  static void zipBad(String n){ try{Fix.zipEntry(n);fails++;System.out.println("FAIL not blocked: "+n);}catch(java.util.zip.ZipException e){System.out.println("ok   blocked "+n);} }
  public static void main(String[] a) throws Exception {
    eq(Fix.zipEntry("images/a.png"),"images/a.png","zip normal");
    eq(Fix.zipEntry("a..b/c.png"),"a..b/c.png","zip dots in name");
    for(String b:new String[]{"../x","a/../../x","/etc/x","..","a/..","..\\x","a\\..\\..\\x"}) zipBad(b);
    eq(Fix.otp("12345 is your CutClick code\nca00ec56eeb"),"12345","otp leading");
    eq(Fix.otp("<#> کد ورود شما: 54321 \n hash"),"54321","otp persian text");
    eq(Fix.otp("abc"),"abc","otp short no digits");
    eq(Fix.otp(null),"","otp null");
    eq(Fix.sqlLike("Ali's kitchen"),"Ali''s kitchen","sql quote");
    eq(Fix.money("2500000000"),Long.valueOf(2500000000L),"money > int");
    eq(Fix.money("1,250,000"),Long.valueOf(1250000L),"money commas");
    eq(Fix.money("12.6"),Long.valueOf(13L),"money decimal");
    eq(Fix.money("abc"),Long.valueOf(0L),"money bad");
    eq(Fix.money(null),Long.valueOf(0L),"money null");
    eq(String.format("%,d",Fix.money("2500000000")),"2,500,000,000","money format");
    eq(Fix.parseIntSafe(" 3 "),3,"int ok"); eq(Fix.parseIntSafe("x"),0,"int bad"); eq(Fix.parseIntSafe(null),0,"int null");
    Field f=Fix.class.getDeclaredField("EXTRA_ROOTS"); f.setAccessible(true);
    CertificateFactory cf=CertificateFactory.getInstance("X.509");
    for(String r:(String[])f.get(null)){ X509Certificate c=(X509Certificate)cf.generateCertificate(new ByteArrayInputStream(java.util.Base64.getMimeDecoder().decode(r))); System.out.println("ok   root "+c.getSubjectX500Principal()); }
    System.out.println(fails==0?"ALL PASSED":"FAILURES: "+fails); System.exit(fails);
  }
}
