package com.ey.echo.builder.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthenticationManager authenticationManager;
    private final SecurityContextRepository contextRepository;

    public AuthController(AuthenticationManager authenticationManager, SecurityContextRepository contextRepository) {
        this.authenticationManager = authenticationManager;
        this.contextRepository = contextRepository;
    }

    public record LoginRequest(@NotBlank String username, @NotBlank String password) {}

    public record CurrentUser(String username, List<String> roles) {

        static CurrentUser of(String username, Iterable<? extends GrantedAuthority> authorities) {
            var roles = new java.util.ArrayList<String>();
            authorities.forEach(a -> roles.add(a.getAuthority().replaceFirst("^ROLE_", "")));
            return new CurrentUser(username, List.copyOf(roles));
        }
    }

    /** Issues the CSRF cookie so the UI can send its first state-changing request. */
    @GetMapping("/csrf")
    public ResponseEntity<Void> csrf(CsrfToken token) {
        token.getToken(); // loading the deferred token writes the XSRF-TOKEN cookie
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/login")
    public ResponseEntity<CurrentUser> login(
            @Valid @RequestBody LoginRequest login, HttpServletRequest request, HttpServletResponse response) {
        Authentication authentication;
        try {
            authentication = authenticationManager.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(login.username(), login.password()));
        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        if (request.getSession(false) != null) {
            request.changeSessionId(); // prevent session fixation
        }
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        contextRepository.saveContext(context, request, response);
        return ResponseEntity.ok(CurrentUser.of(authentication.getName(), authentication.getAuthorities()));
    }

    @GetMapping("/me")
    public CurrentUser me(@AuthenticationPrincipal UserDetails user) {
        return CurrentUser.of(user.getUsername(), user.getAuthorities());
    }
}
